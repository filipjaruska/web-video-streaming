using System.Globalization;
using System.Text.Json;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

namespace WebWVideoStreamingAPI.Infrastructure;

public sealed class VmafAnalysisRequest {
    public required string ReferencePath { get; init; }
    public required string DistortedPath { get; init; }
    public int ReferenceWidth { get; init; }
    public int ReferenceHeight { get; init; }
    public int? DistortedWidth { get; init; }
    public int? DistortedHeight { get; init; }
    public long? BitrateBps { get; init; }
    public string? Model { get; init; }
}

public sealed class VmafAnalysisResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public VmafSeriesData? Series { get; init; }
}

public interface IVmafAnalysisService {
    Task<VmafAnalysisResult> AnalyzeAsync(
        VmafAnalysisRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Full-reference VMAF via ffmpeg libvmaf. Soft-fails when libvmaf is unavailable.
/// </summary>
public sealed class VmafAnalysisService : IVmafAnalysisService {
    private const string DefaultModel = "vmaf_v0.6.1";
    private readonly IFfmpegRunner _ffmpeg;
    private readonly ILogger<VmafAnalysisService> _logger;

    public VmafAnalysisService(IFfmpegRunner ffmpeg, ILogger<VmafAnalysisService> logger) {
        _ffmpeg = ffmpeg;
        _logger = logger;
    }

    public async Task<VmafAnalysisResult> AnalyzeAsync(
        VmafAnalysisRequest request,
        CancellationToken cancellationToken = default) {
        if (!File.Exists(request.ReferencePath)) {
            return Fail($"Reference file not found: {request.ReferencePath}");
        }

        if (!File.Exists(request.DistortedPath)) {
            return Fail($"Distorted file not found: {request.DistortedPath}");
        }

        if (request.ReferenceWidth <= 0 || request.ReferenceHeight <= 0) {
            return Fail("Reference resolution is required for VMAF scaling");
        }

        var tempDir = Path.Combine(Path.GetTempPath(), $"vmaf-{Guid.NewGuid():N}");
        var logPath = Path.Combine(tempDir, "vmaf.json");

        try {
            Directory.CreateDirectory(tempDir);
            await _ffmpeg.EnsureAvailableAsync(cancellationToken);

            var width = request.ReferenceWidth;
            var height = request.ReferenceHeight;
            var model = string.IsNullOrWhiteSpace(request.Model) ? DefaultModel : request.Model;
            var threads = Math.Clamp(Environment.ProcessorCount, 1, 8);

            // Use a relative log path — absolute Windows paths (C:\...) break libvmaf option parsing.
            const string relativeLogName = "vmaf.json";

            // Distorted first (main), reference second — upscale both to reference resolution.
            var filter =
                $"[0:v]scale={width}:{height}:flags=bicubic,settb=AVTB,setpts=PTS-STARTPTS[dist];" +
                $"[1:v]scale={width}:{height}:flags=bicubic,settb=AVTB,setpts=PTS-STARTPTS[ref];" +
                $"[dist][ref]libvmaf=log_fmt=json:log_path={relativeLogName}:n_threads={threads}";

            var args =
                $@"-hide_banner -y -i ""{request.DistortedPath}"" -i ""{request.ReferencePath}"" " +
                $@"-lavfi ""{filter}"" -f null -";

            var run = await _ffmpeg.RunAsync(
                args,
                workingDirectory: tempDir,
                timeout: TimeSpan.FromMinutes(60),
                cancellationToken: cancellationToken);

            if (!run.Success) {
                var message = DescribeFailure(run.ErrorMessage ?? run.StdErr);
                _logger.LogWarning(
                    "VMAF failed for distorted={Distorted} ref={Reference}: {Error}",
                    request.DistortedPath,
                    request.ReferencePath,
                    message);
                return Fail(message);
            }

            if (!File.Exists(logPath)) {
                return Fail("libvmaf did not write a JSON log (is ffmpeg built with --enable-libvmaf?)");
            }

            var series = ParseVmafLog(logPath);
            if (series.Scores.Count == 0) {
                return Fail("No VMAF frame scores found in libvmaf JSON log");
            }

            series.Summary.Model = model;
            series.Summary.Width = request.DistortedWidth;
            series.Summary.Height = request.DistortedHeight;
            series.Summary.BitrateBps = request.BitrateBps;

            return new VmafAnalysisResult {
                Success = true,
                Series = series
            };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "VMAF analysis threw for {Distorted}", request.DistortedPath);
            return Fail(ex.Message);
        } finally {
            TryDeleteDirectory(tempDir);
        }
    }

    private static VmafSeriesData ParseVmafLog(string logPath) {
        var series = new VmafSeriesData();
        using var stream = File.OpenRead(logPath);
        using var doc = JsonDocument.Parse(stream);
        var root = doc.RootElement;

        if (root.TryGetProperty("frames", out var frames)) {
            var index = 0;
            foreach (var frame in frames.EnumerateArray()) {
                if (!TryGetFrameVmaf(frame, out var score)) {
                    continue;
                }

                series.Scores.Add(score);

                series.TimeSec ??= [];
                if (TryGetFrameTime(frame, out var timeSec)) {
                    series.TimeSec.Add(timeSec);
                } else if (frame.TryGetProperty("frameNum", out var frameNum) &&
                           frameNum.TryGetInt32(out var n)) {
                    series.TimeSec.Add(n);
                } else {
                    series.TimeSec.Add(index);
                }

                index++;
            }
        }

        if (root.TryGetProperty("pooled_metrics", out var pooled) &&
            TryGetPooledVmaf(pooled, out var mean, out var harmonicMean, out var min, out var max)) {
            series.Summary.Mean = mean;
            series.Summary.HarmonicMean = harmonicMean;
            series.Summary.Min = min;
            series.Summary.Max = max;
        }

        if (series.Scores.Count > 0) {
            if (series.Summary.Mean == 0) {
                series.Summary.Mean = series.Scores.Average();
            }

            if (series.Summary.HarmonicMean == 0) {
                series.Summary.HarmonicMean = HarmonicMean(series.Scores);
            }

            if (series.Summary.Min == 0 && series.Summary.Max == 0) {
                series.Summary.Min = series.Scores.Min();
                series.Summary.Max = series.Scores.Max();
            } else {
                if (series.Summary.Min == 0) {
                    series.Summary.Min = series.Scores.Min();
                }

                if (series.Summary.Max == 0) {
                    series.Summary.Max = series.Scores.Max();
                }
            }
        }

        return series;
    }

    private static bool TryGetFrameVmaf(JsonElement frame, out double score) {
        score = 0;
        if (frame.TryGetProperty("metrics", out var metrics) &&
            metrics.TryGetProperty("vmaf", out var vmafEl) &&
            TryReadDouble(vmafEl, out score)) {
            return true;
        }

        return false;
    }

    private static bool TryGetFrameTime(JsonElement frame, out double timeSec) {
        timeSec = 0;
        if (frame.TryGetProperty("frameNum", out var frameNum) &&
            frameNum.TryGetInt32(out var n)) {
            // Prefer explicit time when present; otherwise leave to caller via index.
        }

        foreach (var name in new[] { "pts", "ptsTime", "time" }) {
            if (frame.TryGetProperty(name, out var el) && TryReadDouble(el, out timeSec)) {
                return true;
            }
        }

        return false;
    }

    private static bool TryGetPooledVmaf(
        JsonElement pooled,
        out double mean,
        out double harmonicMean,
        out double min,
        out double max) {
        mean = harmonicMean = min = max = 0;
        if (!pooled.TryGetProperty("vmaf", out var vmaf)) {
            return false;
        }

        var ok = false;
        if (vmaf.TryGetProperty("mean", out var meanEl) && TryReadDouble(meanEl, out mean)) {
            ok = true;
        }

        if (vmaf.TryGetProperty("harmonic_mean", out var hmEl) && TryReadDouble(hmEl, out harmonicMean)) {
            ok = true;
        } else if (vmaf.TryGetProperty("harmonicMean", out hmEl) && TryReadDouble(hmEl, out harmonicMean)) {
            ok = true;
        }

        if (vmaf.TryGetProperty("min", out var minEl) && TryReadDouble(minEl, out min)) {
            ok = true;
        }

        if (vmaf.TryGetProperty("max", out var maxEl) && TryReadDouble(maxEl, out max)) {
            ok = true;
        }

        return ok;
    }

    private static bool TryReadDouble(JsonElement el, out double value) {
        value = 0;
        switch (el.ValueKind) {
            case JsonValueKind.Number:
                return el.TryGetDouble(out value);
            case JsonValueKind.String:
                return double.TryParse(el.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out value);
            default:
                return false;
        }
    }

    private static double HarmonicMean(IReadOnlyList<double> values) {
        if (values.Count == 0) {
            return 0;
        }

        double sum = 0;
        var count = 0;
        foreach (var v in values) {
            if (v <= 0) {
                continue;
            }

            sum += 1.0 / v;
            count++;
        }

        return count == 0 ? 0 : count / sum;
    }

    private static string DescribeFailure(string? raw) {
        if (string.IsNullOrWhiteSpace(raw)) {
            return "ffmpeg libvmaf failed";
        }

        if (raw.Contains("No such filter: 'libvmaf'", StringComparison.OrdinalIgnoreCase) ||
            (raw.Contains("libvmaf", StringComparison.OrdinalIgnoreCase) &&
             raw.Contains("not found", StringComparison.OrdinalIgnoreCase))) {
            return "ffmpeg was built without libvmaf. Install an ffmpeg build with --enable-libvmaf (e.g. gyan/BtbN full builds on Windows).";
        }

        if (raw.Contains("No option name near", StringComparison.OrdinalIgnoreCase) ||
            raw.Contains("Error parsing filterchain", StringComparison.OrdinalIgnoreCase)) {
            return "libvmaf filter graph failed to parse (often a Windows log_path issue).";
        }

        // Truncate noisy ffmpeg banners for tree error display.
        var lines = raw.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
        var useful = lines
            .Where(line =>
                line.Contains("error", StringComparison.OrdinalIgnoreCase) ||
                line.Contains("libvmaf", StringComparison.OrdinalIgnoreCase) ||
                line.Contains("Invalid", StringComparison.OrdinalIgnoreCase))
            .Take(3)
            .ToList();

        if (useful.Count > 0) {
            return string.Join(" | ", useful);
        }

        return raw.Length > 400 ? raw[..400] + "…" : raw;
    }

    private void TryDeleteDirectory(string tempDir) {
        try {
            if (Directory.Exists(tempDir)) {
                Directory.Delete(tempDir, recursive: true);
            }
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Failed to delete temp VMAF directory {Path}", tempDir);
        }
    }

    private static VmafAnalysisResult Fail(string message) => new() {
        Success = false,
        ErrorMessage = message
    };
}
