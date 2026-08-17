using System.Text.Json;
using static WebWVideoStreamingAPI.Analysis.MediaFormatting;

namespace WebWVideoStreamingAPI.Analysis;

public sealed class VmafRequest {
    public required string ReferencePath { get; init; }
    public required string DistortedPath { get; init; }
    public int ReferenceWidth { get; init; }
    public int ReferenceHeight { get; init; }
    public int? DistortedWidth { get; init; }
    public int? DistortedHeight { get; init; }
    public long? BitrateBps { get; init; }
    public string? Model { get; init; }
}

public sealed class VmafResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public VmafSeriesData? Series { get; init; }
}

/// <summary>Full-reference VMAF via ffmpeg libvmaf. Soft-fails when libvmaf is unavailable.</summary>
public sealed class VmafAnalyzer {
    private const string DefaultModel = "vmaf_v0.6.1";

    private readonly ProcessRunner _runner;
    private readonly ILogger<VmafAnalyzer> _logger;

    public VmafAnalyzer(ProcessRunner runner, ILogger<VmafAnalyzer> logger) {
        _runner = runner;
        _logger = logger;
    }

    public async Task<VmafResult> AnalyzeAsync(VmafRequest request, CancellationToken cancellationToken = default) {
        if (!File.Exists(request.ReferencePath)) {
            return Fail($"Reference file not found: {request.ReferencePath}");
        }

        if (!File.Exists(request.DistortedPath)) {
            return Fail($"Distorted file not found: {request.DistortedPath}");
        }

        if (request.ReferenceWidth <= 0 || request.ReferenceHeight <= 0) {
            return Fail("Reference resolution is required for VMAF scaling");
        }

        var tempDir = NewTempDir("vmaf");
        // Relative — absolute Windows paths (C:\...) break libvmaf's option parsing.
        const string logName = "vmaf.json";
        var logPath = Path.Combine(tempDir, logName);

        try {
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            var model = string.IsNullOrWhiteSpace(request.Model) ? DefaultModel : request.Model;
            var threads = Math.Clamp(Environment.ProcessorCount, 1, 8);

            // Distorted first (main), reference second — both upscaled to reference resolution.
            var filter =
                $"[0:v]scale={request.ReferenceWidth}:{request.ReferenceHeight}:flags=bicubic,settb=AVTB,setpts=PTS-STARTPTS[dist];" +
                $"[1:v]scale={request.ReferenceWidth}:{request.ReferenceHeight}:flags=bicubic,settb=AVTB,setpts=PTS-STARTPTS[ref];" +
                $"[dist][ref]libvmaf=log_fmt=json:log_path={logName}:n_threads={threads}";

            var args =
                $@"-hide_banner -y -i ""{request.DistortedPath}"" -i ""{request.ReferencePath}"" " +
                $@"-lavfi ""{filter}"" -f null -";

            var run = await _runner.RunAsync(
                "ffmpeg",
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

            var series = ParseLog(logPath);
            if (series.Scores.Count == 0) {
                return Fail("No VMAF frame scores found in libvmaf JSON log");
            }

            series.Summary.Model = model;
            series.Summary.Width = request.DistortedWidth;
            series.Summary.Height = request.DistortedHeight;
            series.Summary.BitrateBps = request.BitrateBps;

            return new VmafResult { Success = true, Series = series };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "VMAF analysis threw for {Distorted}", request.DistortedPath);
            return Fail(ex.Message);
        } finally {
            TryDeleteDirectory(tempDir, _logger);
        }
    }

    private static VmafSeriesData ParseLog(string logPath) {
        var series = new VmafSeriesData();
        using var stream = File.OpenRead(logPath);
        using var doc = JsonDocument.Parse(stream);
        var root = doc.RootElement;

        if (root.TryGetProperty("frames", out var frames)) {
            var index = 0;
            foreach (var frame in frames.EnumerateArray()) {
                if (!TryGetFrameScore(frame, out var score)) {
                    continue;
                }

                series.Scores.Add(score);
                series.TimeSec ??= [];
                series.TimeSec.Add(ResolveFrameTime(frame, index));
                index++;
            }
        }

        if (root.TryGetProperty("pooled_metrics", out var pooled)) {
            ApplyPooledMetrics(pooled, series.Summary);
        }

        FillMissingSummary(series);
        return series;
    }

    private static bool TryGetFrameScore(JsonElement frame, out double score) {
        score = 0;
        return frame.TryGetProperty("metrics", out var metrics) &&
               metrics.TryGetProperty("vmaf", out var vmaf) &&
               TryReadDouble(vmaf, out score);
    }

    /// <summary>Prefers an explicit timestamp, then the frame number, then the running index.</summary>
    private static double ResolveFrameTime(JsonElement frame, int index) {
        foreach (var name in (ReadOnlySpan<string>)["pts", "ptsTime", "time"]) {
            if (frame.TryGetProperty(name, out var element) && TryReadDouble(element, out var timeSec)) {
                return timeSec;
            }
        }

        if (frame.TryGetProperty("frameNum", out var frameNum) && frameNum.TryGetInt32(out var number)) {
            return number;
        }

        return index;
    }

    private static void ApplyPooledMetrics(JsonElement pooled, VmafSummary summary) {
        if (!pooled.TryGetProperty("vmaf", out var vmaf)) {
            return;
        }

        if (vmaf.TryGetProperty("mean", out var mean) && TryReadDouble(mean, out var meanValue)) {
            summary.Mean = meanValue;
        }

        // libvmaf has used both spellings across versions.
        if ((vmaf.TryGetProperty("harmonic_mean", out var harmonic) ||
             vmaf.TryGetProperty("harmonicMean", out harmonic)) &&
            TryReadDouble(harmonic, out var harmonicValue)) {
            summary.HarmonicMean = harmonicValue;
        }

        if (vmaf.TryGetProperty("min", out var min) && TryReadDouble(min, out var minValue)) {
            summary.Min = minValue;
        }

        if (vmaf.TryGetProperty("max", out var max) && TryReadDouble(max, out var maxValue)) {
            summary.Max = maxValue;
        }
    }

    /// <summary>Computes any summary field libvmaf's pooled metrics did not supply.</summary>
    private static void FillMissingSummary(VmafSeriesData series) {
        if (series.Scores.Count == 0) {
            return;
        }

        if (series.Summary.Mean == 0) {
            series.Summary.Mean = series.Scores.Average();
        }

        if (series.Summary.HarmonicMean == 0) {
            series.Summary.HarmonicMean = HarmonicMean(series.Scores);
        }

        if (series.Summary.Min == 0) {
            series.Summary.Min = series.Scores.Min();
        }

        if (series.Summary.Max == 0) {
            series.Summary.Max = series.Scores.Max();
        }
    }

    private static double HarmonicMean(IReadOnlyList<double> values) {
        double sum = 0;
        var count = 0;

        foreach (var value in values) {
            if (value <= 0) {
                continue;
            }

            sum += 1.0 / value;
            count++;
        }

        return count == 0 ? 0 : count / sum;
    }

    /// <summary>Turns ffmpeg's stderr into something worth showing in the analysis tree.</summary>
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

        var useful = raw
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
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

    private static VmafResult Fail(string message) =>
        new() { Success = false, ErrorMessage = message };
}
