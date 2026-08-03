using System.Globalization;
using System.Text.Json;
using WebWVideoStreamingAPI.Infrastructure.Analysis;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

namespace WebWVideoStreamingAPI.Infrastructure;

public sealed class EncodeGridResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public List<EncodeGridPoint> Points { get; init; } = [];
}

public interface IEncodeGridService {
    Task<EncodeGridResult> RunAsync(
        string routeId,
        Guid staticTranscodeId,
        string sourcePath,
        Func<int, int, CancellationToken, Task>? onProgress = null,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Resolution × CRF encode grid with measured bitrate + full-reference VMAF.
/// </summary>
public sealed class EncodeGridService : IEncodeGridService {
    public static readonly int[] DefaultCrfs = [23, 27, 31, 35, 39];

    private readonly IVideoTranscodingService _transcoding;
    private readonly IVmafAnalysisService _vmaf;
    private readonly IMediaProbeService _probe;
    private readonly IVideoTranscodeAnalysisService _analysis;
    private readonly ILogger<EncodeGridService> _logger;

    public EncodeGridService(
        IVideoTranscodingService transcoding,
        IVmafAnalysisService vmaf,
        IMediaProbeService probe,
        IVideoTranscodeAnalysisService analysis,
        ILogger<EncodeGridService> logger) {
        _transcoding = transcoding;
        _vmaf = vmaf;
        _probe = probe;
        _analysis = analysis;
        _logger = logger;
    }

    public async Task<EncodeGridResult> RunAsync(
        string routeId,
        Guid staticTranscodeId,
        string sourcePath,
        Func<int, int, CancellationToken, Task>? onProgress = null,
        CancellationToken cancellationToken = default) {
        var points = new List<EncodeGridPoint>();
        var tempRoot = Path.Combine(Path.GetTempPath(), $"encode-grid-{Guid.NewGuid():N}");

        try {
            Directory.CreateDirectory(tempRoot);

            var refProbe = await _probe.ProbeAsync(sourcePath, cancellationToken);
            if (!refProbe.Success || refProbe.ProbeData == null) {
                return new EncodeGridResult {
                    Success = false,
                    ErrorMessage = refProbe.ErrorMessage ?? "Failed to probe source for encode grid"
                };
            }

            int refW;
            int refH;
            using (refProbe.ProbeData) {
                if (!TryGetVideoResolution(refProbe.ProbeData, out refW, out refH)) {
                    return new EncodeGridResult {
                        Success = false,
                        ErrorMessage = "Could not read source resolution for encode grid"
                    };
                }
            }

            var variants = TranscodeProfile.Default.Variants;
            var total = variants.Count * DefaultCrfs.Length;
            var done = 0;

            if (onProgress != null) {
                await onProgress(done, total, cancellationToken);
            }

            foreach (var variant in variants) {
                ParseResolution(variant.Resolution, out var width, out var height);
                foreach (var crf in DefaultCrfs) {
                    cancellationToken.ThrowIfCancellationRequested();
                    var point = await EncodeAndScoreAsync(
                        sourcePath,
                        tempRoot,
                        variant.Label,
                        variant.Resolution,
                        width,
                        height,
                        crf,
                        refW,
                        refH,
                        cancellationToken);
                    points.Add(point);
                    done++;
                    _logger.LogInformation(
                        "Encode grid {Label} CRF{Crf}: bitrate={Bitrate} vmaf={Vmaf} err={Error}",
                        point.Label,
                        point.Crf,
                        point.BitrateBps,
                        point.VmafMean,
                        point.Error ?? "—");

                    if (onProgress != null) {
                        await onProgress(done, total, cancellationToken);
                    }
                }
            }

            var ok = points.Any(p => string.IsNullOrEmpty(p.Error) && p.BitrateBps > 0);
            await _analysis.SetSeriesAsync(
                staticTranscodeId,
                new AnalysisSeriesDocument { EncodeGrid = points },
                cancellationToken);

            await UpsertEncodeGridTreeAsync(staticTranscodeId, points, cancellationToken);

            return new EncodeGridResult {
                Success = ok,
                ErrorMessage = ok ? null : "No successful encode-grid points",
                Points = points
            };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Encode grid failed for {RouteId}", routeId);
            return new EncodeGridResult {
                Success = false,
                ErrorMessage = ex.Message,
                Points = points
            };
        } finally {
            TryDeleteDirectory(tempRoot);
        }
    }

    private async Task<EncodeGridPoint> EncodeAndScoreAsync(
        string sourcePath,
        string tempRoot,
        string label,
        string resolution,
        int width,
        int height,
        int crf,
        int refW,
        int refH,
        CancellationToken cancellationToken) {
        var point = new EncodeGridPoint {
            Label = label,
            Width = width,
            Height = height,
            Crf = crf
        };

        var outPath = Path.Combine(tempRoot, $"{label}_crf{crf}.mp4");
        var encode = await _transcoding.EncodeCrfAsync(
            sourcePath,
            outPath,
            resolution,
            crf,
            cancellationToken: cancellationToken);

        if (!encode.Success || !File.Exists(outPath)) {
            point.Error = encode.ErrorMessage ?? "CRF encode failed";
            return point;
        }

        var bitrateBps = await MeasureBitrateBpsAsync(outPath, cancellationToken);
        if (bitrateBps <= 0) {
            // Fall back to file size / duration estimate via probe format bit_rate only.
            point.Error = "Could not measure encoded bitrate";
            return point;
        }

        point.BitrateBps = bitrateBps;

        var vmaf = await _vmaf.AnalyzeAsync(
            new VmafAnalysisRequest {
                ReferencePath = sourcePath,
                DistortedPath = outPath,
                ReferenceWidth = refW,
                ReferenceHeight = refH,
                DistortedWidth = width,
                DistortedHeight = height,
                BitrateBps = bitrateBps
            },
            cancellationToken);

        if (!vmaf.Success || vmaf.Series == null) {
            point.Error = vmaf.ErrorMessage ?? "VMAF failed";
            return point;
        }

        point.VmafMean = vmaf.Series.Summary.Mean;
        point.VmafHarmonicMean = vmaf.Series.Summary.HarmonicMean;
        point.VmafMin = vmaf.Series.Summary.Min;
        return point;
    }

    private async Task<long> MeasureBitrateBpsAsync(string path, CancellationToken cancellationToken) {
        var probe = await _probe.ProbeAsync(path, cancellationToken);
        if (!probe.Success || probe.ProbeData == null) {
            return 0;
        }

        using (probe.ProbeData) {
            var root = probe.ProbeData.RootElement;
            if (!root.TryGetProperty("format", out var format)) {
                return 0;
            }

            if (format.TryGetProperty("bit_rate", out var bitRate)) {
                if (bitRate.ValueKind == JsonValueKind.String &&
                    long.TryParse(bitRate.GetString(), out var bps)) {
                    return bps;
                }

                if (bitRate.ValueKind == JsonValueKind.Number && bitRate.TryGetInt64(out var bpsNum)) {
                    return bpsNum;
                }
            }

            // Estimate from size / duration when bit_rate missing.
            long size = 0;
            double duration = 0;
            if (format.TryGetProperty("size", out var sizeEl)) {
                if (sizeEl.ValueKind == JsonValueKind.String) {
                    long.TryParse(sizeEl.GetString(), out size);
                } else if (sizeEl.ValueKind == JsonValueKind.Number) {
                    sizeEl.TryGetInt64(out size);
                }
            }

            if (format.TryGetProperty("duration", out var durEl)) {
                var text = durEl.ValueKind == JsonValueKind.String ? durEl.GetString() : durEl.GetRawText();
                double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out duration);
            }

            if (size > 0 && duration > 0.1) {
                return (long)(size * 8.0 / duration);
            }
        }

        return 0;
    }

    private async Task UpsertEncodeGridTreeAsync(
        Guid transcodeId,
        List<EncodeGridPoint> points,
        CancellationToken cancellationToken) {
        var okCount = points.Count(p => string.IsNullOrEmpty(p.Error));
        var children = points
            .OrderByDescending(p => p.Height)
            .ThenBy(p => p.Crf)
            .Select(p => new AnalysisTreeNode {
                Id = $"encodeGrid.{p.Label}.crf{p.Crf}",
                Label = $"{p.Label} CRF{p.Crf}",
                Value = string.IsNullOrEmpty(p.Error)
                    ? $"VMAF {p.VmafMean:0.##} @ {FormatBitrate(p.BitrateBps)}"
                    : p.Error
            })
            .ToList();

        await _analysis.UpsertSectionAsync(
            transcodeId,
            new AnalysisTreeNode {
                Id = "encodeGrid",
                Label = "Encode grid (res × CRF)",
                Meta = new AnalysisTreeNodeMeta {
                    Source = "encode-grid",
                    Status = okCount > 0 ? AnalysisSectionStatus.Completed : AnalysisSectionStatus.Failed,
                    Kind = "section",
                    Error = okCount > 0 ? null : "No successful grid points"
                },
                Children = children
            },
            cancellationToken);
    }

    private static string FormatBitrate(long bps) {
        if (bps >= 1_000_000) {
            return $"{bps / 1_000_000.0:0.##} Mb/s";
        }

        return $"{bps / 1000.0:0.##} kb/s";
    }

    private static void ParseResolution(string resolution, out int width, out int height) {
        width = 0;
        height = 0;
        var parts = resolution.Split(':', 'x', 'X');
        if (parts.Length == 2) {
            int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out width);
            int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out height);
        }
    }

    private static bool TryGetVideoResolution(System.Text.Json.JsonDocument probeData, out int width, out int height) {
        width = 0;
        height = 0;
        if (!probeData.RootElement.TryGetProperty("streams", out var streams)) {
            return false;
        }

        foreach (var stream in streams.EnumerateArray()) {
            var codecType = stream.TryGetProperty("codec_type", out var typeEl) ? typeEl.GetString() : null;
            if (codecType != "video") {
                continue;
            }

            if (stream.TryGetProperty("width", out var w) &&
                stream.TryGetProperty("height", out var h) &&
                w.TryGetInt32(out width) &&
                h.TryGetInt32(out height) &&
                width > 0 &&
                height > 0) {
                return true;
            }
        }

        return false;
    }

    private void TryDeleteDirectory(string path) {
        try {
            if (Directory.Exists(path)) {
                Directory.Delete(path, recursive: true);
            }
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Failed to delete encode-grid temp dir {Path}", path);
        }
    }
}
