using System.Globalization;
using System.Text.Json;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Infrastructure.Analysis;

public static class MediaInfoTreeBuilder {
    public static List<AnalysisTreeNode> BuildSections(
        JsonDocument probeData,
        string sourcePath,
        Video video) {
        var root = probeData.RootElement;
        var sections = new List<AnalysisTreeNode>();

        if (root.TryGetProperty("format", out var format)) {
            sections.Add(BuildGeneralSection(format, sourcePath, video));
        }

        if (root.TryGetProperty("streams", out var streams)) {
            var videoIndex = 0;
            var audioIndex = 0;
            var subtitleIndex = 0;

            foreach (var stream in streams.EnumerateArray()) {
                var codecType = GetString(stream, "codec_type");
                switch (codecType) {
                    case "video":
                        sections.Add(BuildStreamSection(stream, "Video", videoIndex++));
                        break;
                    case "audio":
                        sections.Add(BuildStreamSection(stream, "Audio", audioIndex++));
                        break;
                    case "subtitle":
                        sections.Add(BuildStreamSection(stream, "Text", subtitleIndex++));
                        break;
                }
            }
        }

        return sections;
    }

    private static AnalysisTreeNode BuildGeneralSection(JsonElement format, string sourcePath, Video video) {
        var children = new List<AnalysisTreeNode>();
        AddIfPresent(children, "general.complete_name", "Complete name", sourcePath);
        AddIfPresent(children, "general.format", "Format", FormatDisplayName(format));
        AddIfPresent(children, "general.format_profile", "Format profile", GetTag(format, "major_brand"));
        AddIfPresent(children, "general.codec_id", "Codec ID", GetTag(format, "compatible_brands"));
        AddIfPresent(children, "general.file_size", "File size", FormatFileSize(GetLong(format, "size") ?? video.SourceSizeBytes));
        AddIfPresent(children, "general.duration", "Duration", FormatDuration(GetDouble(format, "duration")));
        AddIfPresent(children, "general.bit_rate", "Overall bit rate", FormatBitRate(GetLong(format, "bit_rate")));
        AddIfPresent(children, "general.frame_rate", "Frame rate", FormatFrameRate(format));
        AddIfPresent(children, "general.writing_application", "Writing application", GetTag(format, "encoder") ?? GetTag(format, "handler_name"));

        return Section("general", "General", "ffprobe", children);
    }

    private static AnalysisTreeNode BuildStreamSection(JsonElement stream, string prefix, int index) {
        var sectionId = $"{prefix.ToLowerInvariant()}-{index}";
        var sectionLabel = index == 0 ? prefix : $"{prefix} #{index + 1}";
        var children = new List<AnalysisTreeNode>();

        AddIfPresent(children, $"{sectionId}.id", "ID", GetString(stream, "index"));
        AddIfPresent(children, $"{sectionId}.format", "Format", GetCodecFormat(stream));
        AddIfPresent(children, $"{sectionId}.format_info", "Format/Info", GetCodecLongName(stream));
        AddIfPresent(children, $"{sectionId}.format_profile", "Format profile", GetString(stream, "profile"));
        AddIfPresent(children, $"{sectionId}.codec_id", "Codec ID", GetString(stream, "codec_tag_string"));
        AddIfPresent(children, $"{sectionId}.codec_info", "Codec ID/Info", GetCodecLongName(stream));
        AddIfPresent(children, $"{sectionId}.duration", "Duration", FormatDuration(GetDouble(stream, "duration")));
        AddIfPresent(children, $"{sectionId}.bit_rate", "Bit rate", FormatBitRate(GetLong(stream, "bit_rate")));
        AddIfPresent(children, $"{sectionId}.width", "Width", GetInt(stream, "width")?.ToString(CultureInfo.InvariantCulture));
        AddIfPresent(children, $"{sectionId}.height", "Height", GetInt(stream, "height")?.ToString(CultureInfo.InvariantCulture));
        AddIfPresent(children, $"{sectionId}.display_aspect_ratio", "Display aspect ratio", GetString(stream, "display_aspect_ratio"));
        AddIfPresent(children, $"{sectionId}.frame_rate", "Frame rate", FormatFrameRateFromStream(stream));
        AddIfPresent(children, $"{sectionId}.sample_rate", "Sampling rate", FormatSampleRate(GetInt(stream, "sample_rate")));
        AddIfPresent(children, $"{sectionId}.channels", "Channel(s)", GetInt(stream, "channels")?.ToString(CultureInfo.InvariantCulture));
        AddIfPresent(children, $"{sectionId}.channel_layout", "Channel layout", GetString(stream, "channel_layout"));
        AddIfPresent(children, $"{sectionId}.language", "Language", GetTag(stream, "language"));

        if (GetString(stream, "codec_type") == "video") {
            var resolution = FormatResolution(stream);
            if (resolution != null) {
                children.Insert(4, Leaf($"{sectionId}.resolution", "Resolution", resolution));
            }
        }

        return Section(sectionId, sectionLabel, "ffprobe", children);
    }

    private static AnalysisTreeNode Section(string id, string label, string source, List<AnalysisTreeNode> children) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Meta = new AnalysisTreeNodeMeta {
                Source = source,
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

    private static void AddIfPresent(List<AnalysisTreeNode> children, string id, string label, string? value) {
        if (!string.IsNullOrWhiteSpace(value)) {
            children.Add(Leaf(id, label, value));
        }
    }

    private static string? GetString(JsonElement element, string property) {
        if (!element.TryGetProperty(property, out var value)) {
            return null;
        }

        return value.ValueKind switch {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "Yes",
            JsonValueKind.False => "No",
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

        return int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static long? GetLong(JsonElement element, string property) {
        if (!element.TryGetProperty(property, out var value)) {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number)) {
            return number;
        }

        return long.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static double? GetDouble(JsonElement element, string property) {
        if (!element.TryGetProperty(property, out var value)) {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)) {
            return number;
        }

        return double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static string? GetTag(JsonElement element, string key) {
        if (!element.TryGetProperty("tags", out var tags)) {
            return null;
        }

        return GetString(tags, key);
    }

    private static string? GetCodecFormat(JsonElement stream) {
        var codecName = GetString(stream, "codec_name");
        if (codecName == null) {
            return null;
        }

        return codecName.ToUpperInvariant() switch {
            "H264" => "AVC",
            "HEVC" => "HEVC",
            "AAC" => "AAC",
            "MP3" => "MPEG Audio",
            "VP9" => "VP9",
            "AV1" => "AV1",
            _ => codecName.ToUpperInvariant()
        };
    }

    private static string? GetCodecLongName(JsonElement stream) {
        return GetString(stream, "codec_long_name");
    }

    private static string FormatDisplayName(JsonElement format) {
        var formatName = GetString(format, "format_long_name") ?? GetString(format, "format_name");
        return formatName ?? "Unknown";
    }

    private static string? FormatFileSize(long? bytes) {
        if (bytes == null || bytes <= 0) {
            return null;
        }

        const double kib = 1024;
        var value = (double)bytes.Value;

        if (value >= kib * kib * kib) {
            return $"{value / (kib * kib * kib):0.##} GiB";
        }

        if (value >= kib * kib) {
            return $"{value / (kib * kib):0.##} MiB";
        }

        if (value >= kib) {
            return $"{value / kib:0.##} KiB";
        }

        return $"{bytes} bytes";
    }

    private static string? FormatDuration(double? seconds) {
        if (seconds == null || seconds <= 0) {
            return null;
        }

        var total = TimeSpan.FromSeconds(seconds.Value);
        if (total.TotalHours >= 1) {
            return $"{(int)total.TotalHours} h {total.Minutes} min {total.Seconds} s";
        }

        if (total.TotalMinutes >= 1) {
            return $"{(int)total.TotalMinutes} min {total.Seconds} s";
        }

        return $"{total.Seconds}.{total.Milliseconds / 100:D3} s";
    }

    private static string? FormatBitRate(long? bitRate) {
        if (bitRate == null || bitRate <= 0) {
            return null;
        }

        if (bitRate >= 1_000_000) {
            return $"{bitRate.Value / 1_000_000.0:0.##} Mb/s";
        }

        return $"{bitRate.Value / 1000.0:0.##} kb/s";
    }

    private static string? FormatFrameRate(JsonElement format) {
        var frameRate = GetTag(format, "frame_rate");
        if (frameRate != null) {
            return frameRate;
        }

        return null;
    }

    private static string? FormatFrameRateFromStream(JsonElement stream) {
        var rate = GetString(stream, "r_frame_rate") ?? GetString(stream, "avg_frame_rate");
        if (rate == null || rate == "0/0") {
            return null;
        }

        var parts = rate.Split('/');
        if (parts.Length == 2 &&
            double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var num) &&
            double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var den) &&
            den > 0) {
            return $"{num / den:0.###} FPS";
        }

        return rate;
    }

    private static string? FormatSampleRate(int? sampleRate) {
        if (sampleRate == null || sampleRate <= 0) {
            return null;
        }

        if (sampleRate >= 1000) {
            return $"{sampleRate.Value / 1000.0:0.##} kHz";
        }

        return $"{sampleRate} Hz";
    }

    private static string? FormatResolution(JsonElement stream) {
        var width = GetInt(stream, "width");
        var height = GetInt(stream, "height");
        if (width == null || height == null) {
            return null;
        }

        return $"{width}x{height}";
    }
}
