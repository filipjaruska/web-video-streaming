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
    public long? TargetBitrateBps { get; init; }

    /// <summary>How reference and distorted frames are paired up. See <see cref="VmafFrameAlignment"/>.</summary>
    public VmafFrameAlignment FrameAlignment { get; init; } = VmafFrameAlignment.NormalizeToReference;

    /// <summary>
    /// Models to score, first one primary. libvmaf evaluates every model in a single pass, so a
    /// second model is essentially free — only the fusion regression runs twice, not the feature
    /// extraction. Null falls back to <see cref="VmafAnalyzer.DefaultModels"/>.
    /// </summary>
    public IReadOnlyList<VmafModel>? Models { get; init; }
}

/// <summary>A libvmaf built-in model and the key its scores appear under in the JSON log.</summary>
public sealed record VmafModel(string Version, string Name);

/// <summary>How the two inputs are put on a common timeline before libvmaf pairs their frames.</summary>
public enum VmafFrameAlignment {
    /// <summary>
    /// Resample both inputs to the reference's frame rate and renumber timestamps by frame index.
    /// </summary>
    /// <remarks>
    /// libvmaf's framesync pairs frames by timestamp rather than by order, so a variable-frame-rate
    /// reference scored against a constant-rate encode compares mismatched frames. Animation hits
    /// this constantly: content shot "on twos" has its duplicate frames dropped by the container,
    /// which is exactly what makes a source VFR. This is the correct default for every comparison,
    /// including one where the distorted side deliberately dropped duplicate frames to save bits —
    /// there, restoring a common timeline is what makes the saving measurable rather than fatal.
    /// </remarks>
    NormalizeToReference,

    /// <summary>
    /// Leave each input's own timestamps in place. Only meaningful when both sides are already known
    /// to share one timeline, and it will silently mis-pair frames when they do not.
    /// </summary>
    PreserveTimestamps
}

public sealed class VmafResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public VmafSeriesData? Series { get; init; }
}

/// <summary>Full-reference VMAF via ffmpeg libvmaf. Soft-fails when libvmaf is unavailable.</summary>
public sealed class VmafAnalyzer {
    /// <summary>
    /// The classic model plus NEG. NEG ("no enhancement gain") refuses to reward sharpening and
    /// contrast enhancement that raise the score without restoring source detail, so it is the
    /// more conservative of the two; scoring both lets the two be compared at no extra cost.
    /// The primary model is named <c>vmaf</c> so its scores land under the key libvmaf uses when
    /// no model is named at all.
    /// </summary>
    public static readonly IReadOnlyList<VmafModel> DefaultModels = [
        new("vmaf_v0.6.1", PrimaryModelName),
        new("vmaf_v0.6.1neg", NegModelName)
    ];

    public const string PrimaryModelName = "vmaf";
    public const string NegModelName = "neg";

    private readonly ProcessRunner _runner;
    private readonly MediaProbe _probe;
    private readonly ILogger<VmafAnalyzer> _logger;

    public VmafAnalyzer(ProcessRunner runner, MediaProbe probe, ILogger<VmafAnalyzer> logger) {
        _runner = runner;
        _probe = probe;
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

            var models = request.Models is { Count: > 0 } ? request.Models : DefaultModels;

            var frameRate = request.FrameAlignment == VmafFrameAlignment.NormalizeToReference
                ? await TryGetFrameRateAsync(_probe, request.ReferencePath, cancellationToken)
                : null;

            if (frameRate == null && request.FrameAlignment == VmafFrameAlignment.NormalizeToReference) {
                _logger.LogWarning(
                    "No frame rate readable from {Reference}; VMAF frames may not align",
                    request.ReferencePath);
            }

            var run = await RunAsync(request, models, frameRate, tempDir, logName, cancellationToken);

            // Multi-model syntax needs libvmaf 2.x and survives some fiddly filter-option escaping.
            // Rather than guess at the build, fall back to the primary model alone and keep going
            // with a usable score — the NEG comparison is a bonus, not a dependency.
            if (!run.Success && models.Count > 1) {
                _logger.LogWarning(
                    "Multi-model VMAF failed, retrying with {Model} alone: {Error}",
                    models[0].Version,
                    DescribeFailure(run.ErrorMessage ?? run.StdErr));

                TryDeleteFile(logPath);
                models = [models[0]];
                run = await RunAsync(request, models, frameRate, tempDir, logName, cancellationToken);
            }

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

            var series = ParseLog(logPath, models);
            if (series.Scores.Count == 0) {
                return Fail("No VMAF frame scores found in libvmaf JSON log");
            }

            series.Summary.Model = models[0].Version;
            series.Summary.Width = request.DistortedWidth;
            series.Summary.Height = request.DistortedHeight;
            series.Summary.BitrateBps = request.BitrateBps;
            series.Summary.TargetBitrateBps = request.TargetBitrateBps;

            return new VmafResult { Success = true, Series = series };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "VMAF analysis threw for {Distorted}", request.DistortedPath);
            return Fail(ex.Message);
        } finally {
            TryDeleteDirectory(tempDir, _logger);
        }
    }

    private async Task<ProcessResult> RunAsync(
        VmafRequest request,
        IReadOnlyList<VmafModel> models,
        string? frameRate,
        string tempDir,
        string logName,
        CancellationToken cancellationToken) {
        var threads = Math.Clamp(Environment.ProcessorCount, 1, 8);

        // Force both inputs onto one constant frame rate before scoring, then renumber timestamps
        // from the frame index. Without this, libvmaf's framesync pairs frames by timestamp, and a
        // variable-frame-rate source — which anime shot "on twos" typically is, because duplicate
        // frames get dropped — ends up matched against the wrong frames of the constant-rate
        // encode. The symptom is brutal and quiet: most frames score correctly while a large
        // fraction score ~0, dragging the mean far down and the harmonic mean to nearly nothing.
        var sync = frameRate != null
            ? $"fps={frameRate},settb=AVTB,setpts=N/FRAME_RATE/TB"
            : "settb=AVTB,setpts=PTS-STARTPTS";

        // Distorted first (main), reference second — both upscaled to reference resolution.
        var filter =
            $"[0:v]scale={request.ReferenceWidth}:{request.ReferenceHeight}:flags=bicubic,{sync}[dist];" +
            $"[1:v]scale={request.ReferenceWidth}:{request.ReferenceHeight}:flags=bicubic,{sync}[ref];" +
            $"[dist][ref]libvmaf=model={FormatModelOption(models)}:log_fmt=json:log_path={logName}:n_threads={threads}";

        var args =
            $@"-hide_banner -y -i ""{request.DistortedPath}"" -i ""{request.ReferencePath}"" " +
            $@"-lavfi ""{filter}"" -f null -";

        return await _runner.RunAsync(
            "ffmpeg",
            args,
            workingDirectory: tempDir,
            timeout: TimeSpan.FromMinutes(60),
            cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Builds libvmaf's <c>model</c> value: models separated by <c>|</c>, key/value pairs within a
    /// model by <c>:</c>. The colon also separates filter options, so it has to be escaped, and the
    /// whole value is single-quoted to keep the filtergraph parser out of it.
    /// </summary>
    private static string FormatModelOption(IReadOnlyList<VmafModel> models) =>
        "'" + string.Join("|", models.Select(model => $@"version={model.Version}\:name={model.Name}")) + "'";

    private static VmafSeriesData ParseLog(string logPath, IReadOnlyList<VmafModel> models) {
        var series = new VmafSeriesData();
        var primary = models[0].Name;

        using var stream = File.OpenRead(logPath);
        using var doc = JsonDocument.Parse(stream);
        var root = doc.RootElement;

        if (root.TryGetProperty("frames", out var frames)) {
            var index = 0;
            foreach (var frame in frames.EnumerateArray()) {
                if (!TryGetFrameScore(frame, primary, out var score)) {
                    continue;
                }

                series.Scores.Add(score);
                series.TimeSec ??= [];
                series.TimeSec.Add(ResolveFrameTime(frame, index));
                index++;
            }
        }

        if (root.TryGetProperty("pooled_metrics", out var pooled)) {
            foreach (var model in models) {
                if (!pooled.TryGetProperty(model.Name, out var metrics)) {
                    continue;
                }

                var summary = model.Name == primary ? series.Summary : new VmafSummary();
                ApplyPooledMetrics(metrics, summary);
                summary.Model = model.Version;

                series.SummaryByModel ??= [];
                series.SummaryByModel[model.Name] = summary;
            }
        }

        FillMissingSummary(series);
        return series;
    }

    private static bool TryGetFrameScore(JsonElement frame, string modelName, out double score) {
        score = 0;
        if (!frame.TryGetProperty("metrics", out var metrics)) {
            return false;
        }

        return (metrics.TryGetProperty(modelName, out var value) ||
                metrics.TryGetProperty("vmaf", out value)) &&
               TryReadDouble(value, out score);
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

    private static void ApplyPooledMetrics(JsonElement vmaf, VmafSummary summary) {
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

        if (raw.Contains("Could not read model", StringComparison.OrdinalIgnoreCase) ||
            raw.Contains("problem during model initialization", StringComparison.OrdinalIgnoreCase)) {
            return "libvmaf rejected the requested model. This build may predate the built-in NEG model (libvmaf 2.x).";
        }

        if (raw.Contains("No option name near", StringComparison.OrdinalIgnoreCase) ||
            raw.Contains("Error parsing filterchain", StringComparison.OrdinalIgnoreCase)) {
            return "libvmaf filter graph failed to parse (often a Windows log_path issue, or the multi-model model= syntax).";
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
