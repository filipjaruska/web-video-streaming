using System.Globalization;
using System.Text.Json;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;
using static WebWVideoStreamingAPI.Analysis.MediaFormatting;

namespace WebWVideoStreamingAPI.Analysis;

/// <summary>Turns one ffprobe document into MediaInfo-style General / Video / Audio / Text sections.</summary>
public static class MediaInfoTree {
    public static List<AnalysisTreeNode> BuildSections(JsonDocument probeData, string sourcePath, Video video) {
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
                switch (GetString(stream, "codec_type")) {
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
        AddIfPresent(children, "general.format", "Format", GetString(format, "format_long_name") ?? GetString(format, "format_name") ?? "Unknown");
        AddIfPresent(children, "general.format_profile", "Format profile", GetTag(format, "major_brand"));
        AddIfPresent(children, "general.codec_id", "Codec ID", GetTag(format, "compatible_brands"));
        AddIfPresent(children, "general.file_size", "File size", FormatFileSize(GetLong(format, "size") ?? video.SourceSizeBytes));
        AddIfPresent(children, "general.duration", "Duration", FormatDuration(GetDouble(format, "duration")));
        AddIfPresent(children, "general.bit_rate", "Overall bit rate", FormatBitrate(GetLong(format, "bit_rate")));
        AddIfPresent(children, "general.writing_application", "Writing application", GetTag(format, "encoder") ?? GetTag(format, "handler_name"));

        return Section("general", "General", "ffprobe", AnalysisSectionStatus.Completed, children: children);
    }

    private static AnalysisTreeNode BuildStreamSection(JsonElement stream, string prefix, int index) {
        var sectionId = $"{prefix.ToLowerInvariant()}-{index}";
        var sectionLabel = index == 0 ? prefix : $"{prefix} #{index + 1}";
        var codecLongName = GetString(stream, "codec_long_name");
        var children = new List<AnalysisTreeNode>();

        AddIfPresent(children, $"{sectionId}.id", "ID", GetString(stream, "index"));
        AddIfPresent(children, $"{sectionId}.format", "Format", GetCodecFormat(stream));
        AddIfPresent(children, $"{sectionId}.format_info", "Format/Info", codecLongName);
        AddIfPresent(children, $"{sectionId}.format_profile", "Format profile", GetString(stream, "profile"));
        AddIfPresent(children, $"{sectionId}.codec_id", "Codec ID", GetString(stream, "codec_tag_string"));
        AddIfPresent(children, $"{sectionId}.codec_info", "Codec ID/Info", codecLongName);
        AddIfPresent(children, $"{sectionId}.duration", "Duration", FormatDuration(GetDouble(stream, "duration")));
        AddIfPresent(children, $"{sectionId}.bit_rate", "Bit rate", FormatBitrate(GetLong(stream, "bit_rate")));
        AddIfPresent(children, $"{sectionId}.width", "Width", GetInt(stream, "width")?.ToString(CultureInfo.InvariantCulture));
        AddIfPresent(children, $"{sectionId}.height", "Height", GetInt(stream, "height")?.ToString(CultureInfo.InvariantCulture));
        AddIfPresent(children, $"{sectionId}.display_aspect_ratio", "Display aspect ratio", GetString(stream, "display_aspect_ratio"));
        AddIfPresent(children, $"{sectionId}.frame_rate", "Frame rate", FormatFrameRate(stream));
        AddIfPresent(children, $"{sectionId}.sample_rate", "Sampling rate", FormatSampleRate(GetInt(stream, "sample_rate")));
        AddIfPresent(children, $"{sectionId}.channels", "Channel(s)", GetInt(stream, "channels")?.ToString(CultureInfo.InvariantCulture));
        AddIfPresent(children, $"{sectionId}.channel_layout", "Channel layout", GetString(stream, "channel_layout"));
        AddIfPresent(children, $"{sectionId}.language", "Language", GetTag(stream, "language"));

        if (GetString(stream, "codec_type") == "video") {
            var width = GetInt(stream, "width");
            var height = GetInt(stream, "height");
            if (width != null && height != null) {
                // Sits just under the codec identity, matching MediaInfo's ordering.
                children.Insert(Math.Min(4, children.Count), Leaf($"{sectionId}.resolution", "Resolution", $"{width}x{height}"));
            }
        }

        return Section(sectionId, sectionLabel, "ffprobe", AnalysisSectionStatus.Completed, children: children);
    }

    private static string? GetCodecFormat(JsonElement stream) {
        var codecName = GetString(stream, "codec_name");
        if (codecName == null) {
            return null;
        }

        var upper = codecName.ToUpperInvariant();
        return upper switch {
            "H264" => "AVC",
            "MP3" => "MPEG Audio",
            _ => upper
        };
    }

    private static string? FormatFrameRate(JsonElement stream) {
        var rate = GetString(stream, "r_frame_rate") ?? GetString(stream, "avg_frame_rate");
        if (rate == null || rate == "0/0") {
            return null;
        }

        var parts = rate.Split('/');
        if (parts.Length == 2 &&
            double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var numerator) &&
            double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var denominator) &&
            denominator > 0) {
            return $"{numerator / denominator:0.###} FPS";
        }

        return rate;
    }
}
