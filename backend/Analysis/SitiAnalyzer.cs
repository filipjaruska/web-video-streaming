using System.Globalization;
using System.Text.Json;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;
using static WebWVideoStreamingAPI.Analysis.MediaFormatting;

namespace WebWVideoStreamingAPI.Analysis;

public sealed class SitiAnalysisResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public SitiSeriesData? Series { get; init; }
    public AnalysisTreeNode? Section { get; init; }
}

/// <summary>Spatial / temporal perceptual information via ffprobe's lavfi `siti` filter.</summary>
public sealed class SitiAnalyzer {
    private readonly ProcessRunner _runner;
    private readonly ILogger<SitiAnalyzer> _logger;

    public SitiAnalyzer(ProcessRunner runner, ILogger<SitiAnalyzer> logger) {
        _runner = runner;
        _logger = logger;
    }

    public async Task<SitiAnalysisResult> AnalyzeAsync(string sourcePath, CancellationToken cancellationToken = default) {
        var direct = await RunLavfiAsync(sourcePath, cancellationToken);
        if (direct.Success) {
            return direct;
        }

        // The lavfi movie= filter chokes on some paths (spaces, drive letters, odd characters);
        // retrying from a plain temp copy sidesteps the escaping entirely.
        _logger.LogWarning(
            "ffprobe lavfi SI/TI failed for {SourcePath}, retrying via temp copy: {Error}",
            sourcePath,
            direct.ErrorMessage);

        var tempDir = NewTempDir("siti");
        try {
            var tempSource = Path.Combine(tempDir, MediaNames.SourceFile);
            File.Copy(sourcePath, tempSource);
            return await RunLavfiAsync(tempSource, cancellationToken);
        } catch (Exception ex) {
            return Fail(ex.Message);
        } finally {
            TryDeleteDirectory(tempDir, _logger);
        }
    }

    private async Task<SitiAnalysisResult> RunLavfiAsync(string sourcePath, CancellationToken cancellationToken) {
        var input = $"movie='{LavfiPath.EscapeForMovieFilter(sourcePath)}',siti";
        var args = $"-v error -f lavfi -i \"{input}\" -select_streams v:0 -show_frames " +
                   "-show_entries frame=pkt_pts_time:frame_tags=lavfi.siti.si,lavfi.siti.ti " +
                   "-print_format json";

        try {
            var result = await _runner.RunAsync(
                "ffprobe",
                args,
                timeout: TimeSpan.FromMinutes(60),
                cancellationToken: cancellationToken);

            if (!result.Success) {
                return Fail(result.ErrorMessage ?? "ffprobe siti analysis failed");
            }

            var series = ParseFrames(result.StdOut);
            if (series.Si.Count == 0) {
                return Fail("No SI/TI frame data returned from ffprobe");
            }

            return new SitiAnalysisResult {
                Success = true,
                Series = series,
                Section = BuildSection(series)
            };
        } catch (Exception ex) {
            return Fail(ex.Message);
        }
    }

    private static SitiSeriesData ParseFrames(string json) {
        var series = new SitiSeriesData();
        using var doc = JsonDocument.Parse(json);

        if (!doc.RootElement.TryGetProperty("frames", out var frames)) {
            return series;
        }

        foreach (var frame in frames.EnumerateArray()) {
            if (!frame.TryGetProperty("tags", out var tags)) {
                continue;
            }

            var siText = GetTagDirect(tags, "lavfi.siti.si");
            var tiText = GetTagDirect(tags, "lavfi.siti.ti");
            if (siText == null || tiText == null) {
                continue;
            }

            if (!double.TryParse(siText, NumberStyles.Float, CultureInfo.InvariantCulture, out var si) ||
                !double.TryParse(tiText, NumberStyles.Float, CultureInfo.InvariantCulture, out var ti)) {
                continue;
            }

            series.Si.Add(si);
            series.Ti.Add(ti);

            var pts = GetString(frame, "pkt_pts_time");
            if (pts != null &&
                double.TryParse(pts, NumberStyles.Float, CultureInfo.InvariantCulture, out var timeSec)) {
                series.TimeSec ??= [];
                series.TimeSec.Add(timeSec);
            }
        }

        return series;
    }

    /// <summary>
    /// The lavfi tags live directly on the frame's `tags` object rather than nested the way
    /// <see cref="MediaFormatting.GetTag"/> expects, so they are read here.
    /// </summary>
    private static string? GetTagDirect(JsonElement tags, string key) {
        if (tags.TryGetProperty(key, out var value)) {
            return value.GetString();
        }

        foreach (var property in tags.EnumerateObject()) {
            if (string.Equals(property.Name, key, StringComparison.OrdinalIgnoreCase)) {
                return property.Value.GetString();
            }
        }

        return null;
    }

    private static AnalysisTreeNode BuildSection(SitiSeriesData series) {
        var si = ComputeStats(series.Si);
        var ti = ComputeStats(series.Ti);

        return Section(
            "siti",
            "SI/TI Analysis",
            "ffmpeg-siti",
            AnalysisSectionStatus.Completed,
            children: [
                StatLeaf("siti.avg_si", "Average SI", si.Average),
                StatLeaf("siti.max_si", "Max SI", si.Max),
                StatLeaf("siti.min_si", "Min SI", si.Min),
                StatLeaf("siti.std_si", "Std dev SI", si.StdDev),
                StatLeaf("siti.avg_ti", "Average TI", ti.Average),
                StatLeaf("siti.max_ti", "Max TI", ti.Max),
                StatLeaf("siti.min_ti", "Min TI", ti.Min),
                StatLeaf("siti.std_ti", "Std dev TI", ti.StdDev)
            ]);
    }

    private static (double Average, double Min, double Max, double StdDev) ComputeStats(IReadOnlyList<double> values) {
        if (values.Count == 0) {
            return (0, 0, 0, 0);
        }

        var average = values.Average();
        var variance = values.Sum(value => Math.Pow(value - average, 2)) / values.Count;
        return (average, values.Min(), values.Max(), Math.Sqrt(variance));
    }

    private static SitiAnalysisResult Fail(string message) =>
        new() { Success = false, ErrorMessage = message };
}
