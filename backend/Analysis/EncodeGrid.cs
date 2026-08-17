using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;
using static WebWVideoStreamingAPI.Analysis.MediaFormatting;

namespace WebWVideoStreamingAPI.Analysis;

public sealed class EncodeGridResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public List<EncodeGridPoint> Points { get; init; } = [];
}

/// <summary>
/// Sweeps resolution × CRF, measuring real bitrate and full-reference VMAF for each sample.
/// The resulting RD points are what <see cref="LadderDerivation"/> builds a ladder from.
/// </summary>
public sealed class EncodeGrid {
    private static readonly int[] Crfs = [23, 27, 31, 35, 39];

    private readonly Transcoder _transcoder;
    private readonly VmafAnalyzer _vmaf;
    private readonly MediaProbe _probe;
    private readonly AnalysisStore _store;
    private readonly ILogger<EncodeGrid> _logger;

    public EncodeGrid(
        Transcoder transcoder,
        VmafAnalyzer vmaf,
        MediaProbe probe,
        AnalysisStore store,
        ILogger<EncodeGrid> logger) {
        _transcoder = transcoder;
        _vmaf = vmaf;
        _probe = probe;
        _store = store;
        _logger = logger;
    }

    public async Task<EncodeGridResult> RunAsync(
        string routeId,
        Guid staticTranscodeId,
        string sourcePath,
        Func<int, int, CancellationToken, Task>? onProgress = null,
        CancellationToken cancellationToken = default) {
        var points = new List<EncodeGridPoint>();
        var tempRoot = NewTempDir("encode-grid");

        try {
            var reference = await ResolveReferenceResolutionAsync(sourcePath, cancellationToken);
            if (reference == null) {
                return new EncodeGridResult {
                    Success = false,
                    ErrorMessage = "Could not read source resolution for encode grid"
                };
            }

            var variants = TranscodeProfile.Default.Variants;
            var total = variants.Count * Crfs.Length;
            var done = 0;

            if (onProgress != null) {
                await onProgress(done, total, cancellationToken);
            }

            foreach (var variant in variants) {
                var size = ParseResolution(variant.Resolution) ?? (0, 0);

                foreach (var crf in Crfs) {
                    cancellationToken.ThrowIfCancellationRequested();

                    var point = await EncodeAndScoreAsync(
                        sourcePath,
                        tempRoot,
                        variant,
                        size.Item1,
                        size.Item2,
                        crf,
                        reference.Value,
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

            var succeeded = points.Any(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0);

            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                new AnalysisSeriesDocument { EncodeGrid = points },
                cancellationToken);

            await _store.UpsertSectionAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                BuildSection(points),
                cancellationToken);

            return new EncodeGridResult {
                Success = succeeded,
                ErrorMessage = succeeded ? null : "No successful encode-grid points",
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
            TryDeleteDirectory(tempRoot, _logger);
        }
    }

    private async Task<EncodeGridPoint> EncodeAndScoreAsync(
        string sourcePath,
        string tempRoot,
        TranscodeVariant variant,
        int width,
        int height,
        int crf,
        (int Width, int Height) reference,
        CancellationToken cancellationToken) {
        var point = new EncodeGridPoint {
            Label = variant.Label,
            Width = width,
            Height = height,
            Crf = crf
        };

        var outPath = Path.Combine(tempRoot, $"{variant.Label}_crf{crf}.mp4");
        var encode = await _transcoder.EncodeCrfAsync(
            sourcePath,
            outPath,
            variant.Resolution,
            crf,
            cancellationToken: cancellationToken);

        if (!encode.Success || !File.Exists(outPath)) {
            point.Error = encode.ErrorMessage ?? "CRF encode failed";
            return point;
        }

        var bitrateBps = await MeasureBitrateBpsAsync(outPath, cancellationToken);
        if (bitrateBps <= 0) {
            point.Error = "Could not measure encoded bitrate";
            return point;
        }

        point.BitrateBps = bitrateBps;

        var vmaf = await _vmaf.AnalyzeAsync(
            new VmafRequest {
                ReferencePath = sourcePath,
                DistortedPath = outPath,
                ReferenceWidth = reference.Width,
                ReferenceHeight = reference.Height,
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

    private async Task<(int Width, int Height)?> ResolveReferenceResolutionAsync(
        string sourcePath,
        CancellationToken cancellationToken) {
        var probe = await _probe.ProbeAsync(sourcePath, cancellationToken);
        if (!probe.Success || probe.ProbeData == null) {
            return null;
        }

        using (probe.ProbeData) {
            return TryGetVideoResolution(probe.ProbeData, out var width, out var height)
                ? (width, height)
                : null;
        }
    }

    /// <summary>Reads the encoded file's real bitrate, estimating from size ÷ duration if absent.</summary>
    private async Task<long> MeasureBitrateBpsAsync(string path, CancellationToken cancellationToken) {
        var probe = await _probe.ProbeAsync(path, cancellationToken);
        if (!probe.Success || probe.ProbeData == null) {
            return 0;
        }

        using (probe.ProbeData) {
            if (!probe.ProbeData.RootElement.TryGetProperty("format", out var format)) {
                return 0;
            }

            var bitRate = GetLong(format, "bit_rate");
            if (bitRate is > 0) {
                return bitRate.Value;
            }

            var size = GetLong(format, "size") ?? 0;
            var duration = GetDouble(format, "duration") ?? 0;
            return size > 0 && duration > 0.1 ? (long)(size * 8.0 / duration) : 0;
        }
    }

    private static AnalysisTreeNode BuildSection(List<EncodeGridPoint> points) {
        var succeeded = points.Count(point => string.IsNullOrEmpty(point.Error));

        var children = points
            .OrderByDescending(point => point.Height)
            .ThenBy(point => point.Crf)
            .Select(point => Leaf(
                $"encodeGrid.{point.Label}.crf{point.Crf}",
                $"{point.Label} CRF{point.Crf}",
                string.IsNullOrEmpty(point.Error)
                    ? $"VMAF {point.VmafMean:0.##} @ {FormatBitrate(point.BitrateBps)}"
                    : point.Error))
            .ToList();

        return Section(
            "encodeGrid",
            "Encode grid (res × CRF)",
            "encode-grid",
            succeeded > 0 ? AnalysisSectionStatus.Completed : AnalysisSectionStatus.Failed,
            succeeded > 0 ? null : "No successful grid points",
            children);
    }
}
