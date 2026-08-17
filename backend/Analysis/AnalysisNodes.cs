using System.Globalization;

namespace WebWVideoStreamingAPI.Analysis;

/// <summary>
/// The one place an <see cref="AnalysisTreeNode"/> is constructed. Every producer — the media-info
/// tree, SI/TI, VMAF, the encode grid, ladder derivation, subtitles, and the read-time placeholder
/// builder — goes through these three factories so the tree shape stays consistent.
/// </summary>
public static class AnalysisNodes {
    /// <summary>Source tag for anything probed out of a packaged rung.</summary>
    public const string TranscodeProbeSource = "ffprobe-transcode";

    public static AnalysisTreeNode Section(
        string id,
        string label,
        string source,
        AnalysisSectionStatus status,
        string? error = null,
        List<AnalysisTreeNode>? children = null) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Meta = new AnalysisTreeNodeMeta {
                Source = source,
                Status = status,
                Kind = "section",
                Error = error
            },
            Children = children
        };
    }

    public static AnalysisTreeNode Leaf(string id, string label, string? value) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Value = value
        };
    }

    public static AnalysisTreeNode StatLeaf(string id, string label, double value) {
        return Leaf(id, label, value.ToString("0.####", CultureInfo.InvariantCulture));
    }

    /// <summary>Adds a leaf only when the value is non-empty, so absent probe fields stay out of the tree.</summary>
    public static void AddIfPresent(List<AnalysisTreeNode> children, string id, string label, string? value) {
        if (!string.IsNullOrWhiteSpace(value)) {
            children.Add(Leaf(id, label, value));
        }
    }
}
