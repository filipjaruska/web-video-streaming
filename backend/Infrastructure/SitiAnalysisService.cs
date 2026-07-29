using System.Globalization;
using System.Text.Json;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

namespace WebWVideoStreamingAPI.Infrastructure;

public sealed class SitiAnalysisResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public SitiSeriesData? Series { get; init; }
    public AnalysisTreeNode? Section { get; init; }
}

public interface ISitiAnalysisService {
    Task<SitiAnalysisResult> AnalyzeAsync(string sourcePath, CancellationToken cancellationToken = default);
}

public class SitiAnalysisService : ISitiAnalysisService {
    private readonly IMediaProcessRunner _runner;
    private readonly ILogger<SitiAnalysisService> _logger;

    public SitiAnalysisService(IMediaProcessRunner runner, ILogger<SitiAnalysisService> logger) {
        _runner = runner;
        _logger = logger;
    }

    public async Task<SitiAnalysisResult> AnalyzeAsync(string sourcePath, CancellationToken cancellationToken = default) {
        var lavfiResult = await TryAnalyzeViaFfprobeLavfiAsync(sourcePath, cancellationToken);
        if (lavfiResult.Success) {
            return lavfiResult;
        }

        _logger.LogWarning(
            "ffprobe lavfi SI/TI failed for {SourcePath}, retrying via temp copy: {Error}",
            sourcePath,
            lavfiResult.ErrorMessage);

        return await AnalyzeViaTempCopyAsync(sourcePath, cancellationToken);
    }

    private async Task<SitiAnalysisResult> TryAnalyzeViaFfprobeLavfiAsync(
        string sourcePath,
        CancellationToken cancellationToken) {
        var escapedPath = LavfiPathHelper.EscapeForMovieFilter(sourcePath);
        var input = $"movie='{escapedPath}',siti";
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
                return new SitiAnalysisResult {
                    Success = false,
                    ErrorMessage = result.ErrorMessage ?? "ffprobe siti analysis failed"
                };
            }

            var series = ParseFfprobeFrames(result.StdOut);
            if (series.Si.Count == 0) {
                return new SitiAnalysisResult {
                    Success = false,
                    ErrorMessage = "No SI/TI frame data returned from ffprobe"
                };
            }

            return new SitiAnalysisResult {
                Success = true,
                Series = series,
                Section = BuildSection(series)
            };
        } catch (Exception ex) {
            return new SitiAnalysisResult {
                Success = false,
                ErrorMessage = ex.Message
            };
        }
    }

    private async Task<SitiAnalysisResult> AnalyzeViaTempCopyAsync(
        string sourcePath,
        CancellationToken cancellationToken) {
        var tempDir = Path.Combine(Path.GetTempPath(), $"siti-{Guid.NewGuid():N}");
        var tempSource = Path.Combine(tempDir, "source.mp4");

        try {
            Directory.CreateDirectory(tempDir);
            File.Copy(sourcePath, tempSource);

            return await TryAnalyzeViaFfprobeLavfiAsync(tempSource, cancellationToken);
        } catch (Exception ex) {
            return new SitiAnalysisResult {
                Success = false,
                ErrorMessage = ex.Message
            };
        } finally {
            try {
                if (Directory.Exists(tempDir)) {
                    Directory.Delete(tempDir, recursive: true);
                }
            } catch (Exception ex) {
                _logger.LogWarning(ex, "Failed to delete temp SI/TI directory {Path}", tempDir);
            }
        }
    }

    private static SitiSeriesData ParseFfprobeFrames(string json) {
        var series = new SitiSeriesData();
        using var doc = JsonDocument.Parse(json);

        if (!doc.RootElement.TryGetProperty("frames", out var frames)) {
            return series;
        }

        foreach (var frame in frames.EnumerateArray()) {
            if (!frame.TryGetProperty("tags", out var tags)) {
                continue;
            }

            var siText = GetTagValue(tags, "lavfi.siti.si");
            var tiText = GetTagValue(tags, "lavfi.siti.ti");
            if (siText == null || tiText == null) {
                continue;
            }

            if (!double.TryParse(siText, NumberStyles.Float, CultureInfo.InvariantCulture, out var si) ||
                !double.TryParse(tiText, NumberStyles.Float, CultureInfo.InvariantCulture, out var ti)) {
                continue;
            }

            series.Si.Add(si);
            series.Ti.Add(ti);

            var pts = GetStringValue(frame, "pkt_pts_time");
            if (pts != null &&
                double.TryParse(pts, NumberStyles.Float, CultureInfo.InvariantCulture, out var timeSec)) {
                series.TimeSec ??= [];
                series.TimeSec.Add(timeSec);
            }
        }

        return series;
    }

    private static AnalysisTreeNode BuildSection(SitiSeriesData series) {
        var siStats = ComputeStats(series.Si);
        var tiStats = ComputeStats(series.Ti);

        var children = new List<AnalysisTreeNode> {
            StatLeaf("siti.avg_si", "Average SI", siStats.Average),
            StatLeaf("siti.max_si", "Max SI", siStats.Max),
            StatLeaf("siti.min_si", "Min SI", siStats.Min),
            StatLeaf("siti.std_si", "Std dev SI", siStats.StdDev),
            StatLeaf("siti.avg_ti", "Average TI", tiStats.Average),
            StatLeaf("siti.max_ti", "Max TI", tiStats.Max),
            StatLeaf("siti.min_ti", "Min TI", tiStats.Min),
            StatLeaf("siti.std_ti", "Std dev TI", tiStats.StdDev),
        };

        return new AnalysisTreeNode {
            Id = "siti",
            Label = "SI/TI Analysis",
            Meta = new AnalysisTreeNodeMeta {
                Source = "ffmpeg-siti",
                Status = AnalysisSectionStatus.Completed,
                Kind = "section"
            },
            Children = children
        };
    }

    private static AnalysisTreeNode StatLeaf(string id, string label, double value) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Value = value.ToString("0.####", CultureInfo.InvariantCulture)
        };
    }

    private static (double Average, double Min, double Max, double StdDev) ComputeStats(IReadOnlyList<double> values) {
        if (values.Count == 0) {
            return (0, 0, 0, 0);
        }

        var min = values.Min();
        var max = values.Max();
        var average = values.Average();
        var variance = values.Sum(v => Math.Pow(v - average, 2)) / values.Count;
        var stdDev = Math.Sqrt(variance);
        return (average, min, max, stdDev);
    }

    private static string? GetTagValue(JsonElement tags, string key) {
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

    private static string? GetStringValue(JsonElement element, string property) {
        return element.TryGetProperty(property, out var value) ? value.GetString() : null;
    }
}
