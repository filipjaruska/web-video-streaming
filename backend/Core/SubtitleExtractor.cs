using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using WebWVideoStreamingAPI.Analysis;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;
using static WebWVideoStreamingAPI.Analysis.MediaFormatting;

namespace WebWVideoStreamingAPI.Core;

public sealed class SubtitleTrackInfo {
    public required string Id { get; init; }
    public required string Language { get; init; }
    public required string Label { get; init; }
    public required string FileName { get; init; }
}

public sealed class SkippedSubtitleInfo {
    public required string Id { get; init; }
    public required string Language { get; init; }
    public required string Label { get; init; }
    public required string Reason { get; init; }
}

public sealed class SubtitleManifest {
    [JsonPropertyName("tracks")]
    public List<SubtitleTrackInfo> Tracks { get; init; } = [];

    [JsonPropertyName("skipped")]
    public List<SkippedSubtitleInfo> Skipped { get; init; } = [];
}

public sealed class SubtitleExtractionResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public SubtitleManifest Manifest { get; init; } = new();
    public AnalysisTreeNode? Section { get; init; }
}

/// <summary>
/// Extracts soft text subtitle streams to WebVTT side-cars under {routeId}/subs/.
/// Image-based codecs (PGS, VobSub, etc.) are skipped and recorded in the manifest.
/// </summary>
public sealed class SubtitleExtractor {
    private const string SectionId = "subtitles";
    private const string SectionLabel = "Subtitles";
    private const string SectionSource = "ffmpeg-webvtt";

    private static readonly HashSet<string> ImageBasedCodecs = new(StringComparer.OrdinalIgnoreCase) {
        "hdmv_pgs_subtitle",
        "dvd_subtitle",
        "dvdsub",
        "pgssub",
        "xsub",
        "dvb_subtitle",
        "dvb_teletext"
    };

    private static readonly JsonSerializerOptions ManifestJson = new() {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly MediaPaths _paths;
    private readonly MediaProbe _probe;
    private readonly ProcessRunner _runner;
    private readonly ILogger<SubtitleExtractor> _logger;

    public SubtitleExtractor(
        MediaPaths paths,
        MediaProbe probe,
        ProcessRunner runner,
        ILogger<SubtitleExtractor> logger) {
        _paths = paths;
        _probe = probe;
        _runner = runner;
        _logger = logger;
    }

    public async Task<SubtitleExtractionResult> ExtractAsync(
        string routeId,
        string sourcePath,
        CancellationToken cancellationToken = default) {
        try {
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            var probe = await _probe.ProbeAsync(sourcePath, cancellationToken);
            if (!probe.Success || probe.ProbeData == null) {
                return Fail(probe.ErrorMessage ?? "Media probe failed");
            }

            _paths.EnsureSubsDir(routeId);
            ClearExistingSubs(routeId);

            var tracks = new List<SubtitleTrackInfo>();
            var skipped = new List<SkippedSubtitleInfo>();

            using (probe.ProbeData) {
                if (!probe.ProbeData.RootElement.TryGetProperty("streams", out var streams)) {
                    return await WriteEmptyAsync(routeId, "No streams in probe", cancellationToken);
                }

                var ordinal = 0;
                foreach (var stream in streams.EnumerateArray()) {
                    if (!string.Equals(GetString(stream, "codec_type"), "subtitle", StringComparison.OrdinalIgnoreCase)) {
                        continue;
                    }

                    await ExtractStreamAsync(routeId, sourcePath, stream, ordinal, tracks, skipped, cancellationToken);
                    ordinal++;
                }
            }

            var manifest = new SubtitleManifest { Tracks = tracks, Skipped = skipped };
            await WriteManifestAsync(routeId, manifest, cancellationToken);

            _logger.LogInformation(
                "Subtitle extraction for {RouteId}: {TrackCount} VTT, {SkippedCount} skipped",
                routeId,
                tracks.Count,
                skipped.Count);

            return new SubtitleExtractionResult {
                Success = true,
                Manifest = manifest,
                Section = BuildSection(tracks, skipped)
            };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Subtitle extraction failed for {RouteId}", routeId);
            return Fail(ex.Message);
        }
    }

    private async Task ExtractStreamAsync(
        string routeId,
        string sourcePath,
        JsonElement stream,
        int ordinal,
        List<SubtitleTrackInfo> tracks,
        List<SkippedSubtitleInfo> skipped,
        CancellationToken cancellationToken) {
        var streamIndex = GetInt(stream, "index") ?? ordinal;
        var codec = GetString(stream, "codec_name") ?? "unknown";
        var language = NormalizeLanguage(GetTag(stream, "language"));
        var id = streamIndex.ToString(CultureInfo.InvariantCulture);
        var label = BuildLabel(GetTag(stream, "title"), language, codec, ordinal);

        if (ImageBasedCodecs.Contains(codec)) {
            skipped.Add(new SkippedSubtitleInfo {
                Id = id,
                Language = language,
                Label = label,
                Reason = $"Image-based subtitle ({codec}) is not supported; browsers need WebVTT text tracks."
            });
            return;
        }

        var fileName = $"{id}.{SanitizeFileToken(language)}.vtt";
        var outputPath = Path.Combine(_paths.SubsDir(routeId), fileName);

        // Map by absolute stream index so we hit the correct subtitle even when video/audio
        // occupy earlier indices.
        var run = await _runner.RunAsync(
            "ffmpeg",
            $@"-y -i ""{sourcePath}"" -map 0:{streamIndex} -c:s webvtt ""{outputPath}""",
            timeout: TimeSpan.FromMinutes(5),
            cancellationToken: cancellationToken);

        if (!run.Success || !File.Exists(outputPath) || new FileInfo(outputPath).Length == 0) {
            skipped.Add(new SkippedSubtitleInfo {
                Id = id,
                Language = language,
                Label = label,
                Reason = $"Failed to convert {codec} to WebVTT: {run.ErrorMessage ?? Truncate(run.StdErr)}"
            });
            TryDelete(outputPath);
            return;
        }

        tracks.Add(new SubtitleTrackInfo {
            Id = id,
            Language = language,
            Label = label,
            FileName = fileName
        });
    }

    private async Task<SubtitleExtractionResult> WriteEmptyAsync(
        string routeId,
        string? note,
        CancellationToken cancellationToken) {
        var manifest = new SubtitleManifest();

        try {
            _paths.EnsureSubsDir(routeId);
            await WriteManifestAsync(routeId, manifest, cancellationToken);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Failed to write empty subtitle manifest for {RouteId}", routeId);
        }

        return new SubtitleExtractionResult {
            Success = true,
            Manifest = manifest,
            Section = BuildSection(manifest.Tracks, manifest.Skipped, note)
        };
    }

    private Task WriteManifestAsync(string routeId, SubtitleManifest manifest, CancellationToken cancellationToken) {
        return File.WriteAllTextAsync(
            _paths.SubsManifestFile(routeId),
            JsonSerializer.Serialize(manifest, ManifestJson),
            cancellationToken);
    }

    private void ClearExistingSubs(string routeId) {
        var dir = _paths.SubsDir(routeId);
        if (!Directory.Exists(dir)) {
            return;
        }

        foreach (var file in Directory.EnumerateFiles(dir)) {
            TryDelete(file);
        }
    }

    private static AnalysisTreeNode BuildSection(
        IReadOnlyList<SubtitleTrackInfo> tracks,
        IReadOnlyList<SkippedSubtitleInfo> skipped,
        string? note = null) {
        var children = new List<AnalysisTreeNode>();

        AddIfPresent(children, "subtitles.note", "Note", note);
        children.Add(Leaf("subtitles.extracted", "Extracted WebVTT tracks", Count(tracks.Count)));

        for (var i = 0; i < tracks.Count; i++) {
            children.Add(Leaf(
                $"subtitles.track.{i}",
                tracks[i].Label,
                $"{tracks[i].FileName} ({tracks[i].Language})"));
        }

        if (skipped.Count > 0) {
            children.Add(Leaf("subtitles.skipped_count", "Skipped tracks", Count(skipped.Count)));

            for (var i = 0; i < skipped.Count; i++) {
                children.Add(Leaf($"subtitles.skipped.{i}", skipped[i].Label, skipped[i].Reason));
            }
        }

        return Section(SectionId, SectionLabel, SectionSource, AnalysisSectionStatus.Completed, children: children);
    }

    private static SubtitleExtractionResult Fail(string message) {
        return new SubtitleExtractionResult {
            Success = false,
            ErrorMessage = message,
            Section = Section(SectionId, SectionLabel, SectionSource, AnalysisSectionStatus.Failed, message, children: [])
        };
    }

    private static string BuildLabel(string? title, string language, string codec, int ordinal) {
        if (!string.IsNullOrWhiteSpace(title)) {
            return title.Trim();
        }

        if (!string.Equals(language, "und", StringComparison.OrdinalIgnoreCase)) {
            return $"{language.ToUpperInvariant()} ({codec})";
        }

        return ordinal == 0 ? $"Subtitles ({codec})" : $"Subtitles #{ordinal + 1} ({codec})";
    }

    private static string NormalizeLanguage(string? language) {
        if (string.IsNullOrWhiteSpace(language) ||
            string.Equals(language, "unk", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(language, "und", StringComparison.OrdinalIgnoreCase)) {
            return "und";
        }

        return language.Trim().ToLowerInvariant();
    }

    private static string SanitizeFileToken(string language) {
        var token = Regex.Replace(language, @"[^a-zA-Z0-9_-]+", "_");
        return string.IsNullOrWhiteSpace(token) ? "und" : token;
    }

    private static string Truncate(string? text, int max = 240) {
        if (string.IsNullOrWhiteSpace(text)) {
            return "unknown error";
        }

        var trimmed = text.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max] + "…";
    }

    private static void TryDelete(string path) {
        try {
            if (File.Exists(path)) {
                File.Delete(path);
            }
        } catch {
            // Best-effort cleanup; a stale side-car is harmless.
        }
    }

    private static string Count(int value) => value.ToString(CultureInfo.InvariantCulture);
}
