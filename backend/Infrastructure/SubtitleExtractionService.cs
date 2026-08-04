using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using WebWVideoStreamingAPI.Core;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

namespace WebWVideoStreamingAPI.Infrastructure;

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

public interface ISubtitleExtractionService {
    Task<SubtitleExtractionResult> ExtractAsync(
        string routeId,
        string sourcePath,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Extracts soft text subtitle streams to WebVTT side-cars under {routeId}/subs/.
/// Image-based codecs (PGS, VobSub, etc.) are skipped and recorded in the manifest.
/// </summary>
public sealed class SubtitleExtractionService : ISubtitleExtractionService {
    private static readonly HashSet<string> ImageBasedCodecs = new(StringComparer.OrdinalIgnoreCase) {
        "hdmv_pgs_subtitle",
        "dvd_subtitle",
        "dvdsub",
        "pgssub",
        "xsub",
        "dvb_subtitle",
        "dvb_teletext"
    };

    private static readonly JsonSerializerOptions JsonOptions = new() {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly IVideoStorageService _storage;
    private readonly IMediaProbeService _probe;
    private readonly IFfmpegRunner _ffmpeg;
    private readonly ILogger<SubtitleExtractionService> _logger;

    public SubtitleExtractionService(
        IVideoStorageService storage,
        IMediaProbeService probe,
        IFfmpegRunner ffmpeg,
        ILogger<SubtitleExtractionService> logger) {
        _storage = storage;
        _probe = probe;
        _ffmpeg = ffmpeg;
        _logger = logger;
    }

    public async Task<SubtitleExtractionResult> ExtractAsync(
        string routeId,
        string sourcePath,
        CancellationToken cancellationToken = default) {
        try {
            await _ffmpeg.EnsureAvailableAsync(cancellationToken);

            var probe = await _probe.ProbeAsync(sourcePath, cancellationToken);
            if (!probe.Success || probe.ProbeData == null) {
                return Fail(probe.ErrorMessage ?? "Media probe failed");
            }

            _storage.EnsureSubsDir(routeId);
            ClearExistingSubs(routeId);

            var tracks = new List<SubtitleTrackInfo>();
            var skipped = new List<SkippedSubtitleInfo>();
            var textStreamOrdinal = 0;

            using (probe.ProbeData) {
                if (!probe.ProbeData.RootElement.TryGetProperty("streams", out var streams)) {
                    return WriteEmpty(routeId, "No streams in probe");
                }

                foreach (var stream in streams.EnumerateArray()) {
                    if (!string.Equals(GetString(stream, "codec_type"), "subtitle", StringComparison.OrdinalIgnoreCase)) {
                        continue;
                    }

                    var streamIndex = GetInt(stream, "index") ?? textStreamOrdinal;
                    var codec = GetString(stream, "codec_name") ?? "unknown";
                    var language = NormalizeLanguage(GetTag(stream, "language"));
                    var title = GetTag(stream, "title");
                    var id = streamIndex.ToString(CultureInfo.InvariantCulture);
                    var label = BuildLabel(title, language, codec, textStreamOrdinal);

                    if (ImageBasedCodecs.Contains(codec)) {
                        skipped.Add(new SkippedSubtitleInfo {
                            Id = id,
                            Language = language,
                            Label = label,
                            Reason = $"Image-based subtitle ({codec}) is not supported; browsers need WebVTT text tracks."
                        });
                        textStreamOrdinal++;
                        continue;
                    }

                    var fileName = $"{id}.{SanitizeFileToken(language)}.vtt";
                    var outputPath = Path.Combine(_storage.GetSubsDir(routeId), fileName);

                    // Map by absolute stream index so we hit the correct subtitle even when
                    // video/audio occupy earlier indices.
                    var args =
                        $@"-y -i ""{sourcePath}"" -map 0:{streamIndex} -c:s webvtt ""{outputPath}""";
                    var run = await _ffmpeg.RunAsync(
                        args,
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
                        textStreamOrdinal++;
                        continue;
                    }

                    tracks.Add(new SubtitleTrackInfo {
                        Id = id,
                        Language = language,
                        Label = label,
                        FileName = fileName
                    });
                    textStreamOrdinal++;
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
                Section = BuildAnalysisSection(tracks, skipped)
            };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Subtitle extraction failed for {RouteId}", routeId);
            return Fail(ex.Message);
        }
    }

    private SubtitleExtractionResult WriteEmpty(string routeId, string? note) {
        var manifest = new SubtitleManifest();
        try {
            _storage.EnsureSubsDir(routeId);
            File.WriteAllText(
                _storage.GetSubsManifestPath(routeId),
                JsonSerializer.Serialize(manifest, JsonOptions));
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Failed to write empty subtitle manifest for {RouteId}", routeId);
        }

        return new SubtitleExtractionResult {
            Success = true,
            Manifest = manifest,
            Section = BuildAnalysisSection(manifest.Tracks, manifest.Skipped, note)
        };
    }

    private SubtitleExtractionResult Fail(string message) {
        return new SubtitleExtractionResult {
            Success = false,
            ErrorMessage = message,
            Section = AnalysisTreeHelpers.FailedSection(
                "subtitles",
                "Subtitles",
                "ffmpeg-webvtt",
                message)
        };
    }

    private async Task WriteManifestAsync(
        string routeId,
        SubtitleManifest manifest,
        CancellationToken cancellationToken) {
        var path = _storage.GetSubsManifestPath(routeId);
        var json = JsonSerializer.Serialize(manifest, JsonOptions);
        await File.WriteAllTextAsync(path, json, cancellationToken);
    }

    private void ClearExistingSubs(string routeId) {
        var dir = _storage.GetSubsDir(routeId);
        if (!Directory.Exists(dir)) {
            return;
        }

        foreach (var file in Directory.EnumerateFiles(dir)) {
            TryDelete(file);
        }
    }

    private static AnalysisTreeNode BuildAnalysisSection(
        IReadOnlyList<SubtitleTrackInfo> tracks,
        IReadOnlyList<SkippedSubtitleInfo> skipped,
        string? note = null) {
        var children = new List<AnalysisTreeNode>();

        if (!string.IsNullOrWhiteSpace(note)) {
            children.Add(Leaf("subtitles.note", "Note", note));
        }

        children.Add(Leaf(
            "subtitles.extracted",
            "Extracted WebVTT tracks",
            tracks.Count.ToString(CultureInfo.InvariantCulture)));

        for (var i = 0; i < tracks.Count; i++) {
            var track = tracks[i];
            children.Add(Leaf(
                $"subtitles.track.{i}",
                track.Label,
                $"{track.FileName} ({track.Language})"));
        }

        if (skipped.Count > 0) {
            children.Add(Leaf(
                "subtitles.skipped_count",
                "Skipped tracks",
                skipped.Count.ToString(CultureInfo.InvariantCulture)));

            for (var i = 0; i < skipped.Count; i++) {
                var item = skipped[i];
                children.Add(Leaf(
                    $"subtitles.skipped.{i}",
                    item.Label,
                    item.Reason));
            }
        }

        return new AnalysisTreeNode {
            Id = "subtitles",
            Label = "Subtitles",
            Meta = new AnalysisTreeNodeMeta {
                Source = "ffmpeg-webvtt",
                Status = AnalysisSectionStatus.Completed,
                Kind = "section"
            },
            Children = children
        };
    }

    private static AnalysisTreeNode Leaf(string id, string label, string? value) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Value = value
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

    private static string? GetString(JsonElement element, string property) {
        if (!element.TryGetProperty(property, out var value)) {
            return null;
        }

        return value.ValueKind switch {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.ToString(),
            _ => null
        };
    }

    private static int? GetInt(JsonElement element, string property) {
        if (!element.TryGetProperty(property, out var value)) {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) {
            return number;
        }

        if (value.ValueKind == JsonValueKind.String &&
            int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)) {
            return parsed;
        }

        return null;
    }

    private static string? GetTag(JsonElement stream, string key) {
        if (!stream.TryGetProperty("tags", out var tags) || tags.ValueKind != JsonValueKind.Object) {
            return null;
        }

        if (!tags.TryGetProperty(key, out var value)) {
            // ffprobe sometimes uses TITLE vs title
            foreach (var prop in tags.EnumerateObject()) {
                if (string.Equals(prop.Name, key, StringComparison.OrdinalIgnoreCase)) {
                    return prop.Value.GetString();
                }
            }

            return null;
        }

        return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
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
            // ignore
        }
    }
}

/// <summary>Small helpers shared with pipeline failure marking.</summary>
internal static class AnalysisTreeHelpers {
    public static AnalysisTreeNode FailedSection(string id, string label, string source, string error) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Meta = new AnalysisTreeNodeMeta {
                Source = source,
                Status = AnalysisSectionStatus.Failed,
                Kind = "section",
                Error = error
            },
            Children = []
        };
    }
}
