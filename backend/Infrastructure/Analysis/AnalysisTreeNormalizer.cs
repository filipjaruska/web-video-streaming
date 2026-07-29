using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

namespace WebWVideoStreamingAPI.Infrastructure.Analysis;

public static class AnalysisTreeNormalizer {
    private static readonly HashSet<string> DeprecatedNodeIds = new(StringComparer.OrdinalIgnoreCase) {
        "general.encoded_date",
        "general.tagged_date",
        "siti.frames",
    };

    public static AnalysisTreeDocument Normalize(AnalysisTreeDocument tree) {
        return new AnalysisTreeDocument {
            Id = tree.Id,
            Label = tree.Label,
            Children = NormalizeNodes(tree.Children)
        };
    }

    public static List<AnalysisTreeNode> NormalizeNodes(IEnumerable<AnalysisTreeNode>? nodes) {
        if (nodes == null) {
            return [];
        }

        var result = new List<AnalysisTreeNode>();

        foreach (var node in nodes) {
            var normalized = NormalizeNode(node);
            if (normalized != null) {
                result.Add(normalized);
            }
        }

        return result;
    }

    private static AnalysisTreeNode? NormalizeNode(AnalysisTreeNode node) {
        if (IsDeprecated(node)) {
            return null;
        }

        var children = NormalizeNodes(node.Children);
        var isEmptyLeaf = (node.Children == null || node.Children.Count == 0) &&
                          string.IsNullOrWhiteSpace(node.Value);

        if (isEmptyLeaf && node.Meta?.Kind != "section") {
            return null;
        }

        return new AnalysisTreeNode {
            Id = node.Id,
            Label = node.Label,
            Value = node.Value,
            Meta = node.Meta,
            Children = children.Count > 0 ? children : null
        };
    }

    private static bool IsDeprecated(AnalysisTreeNode node) {
        if (DeprecatedNodeIds.Contains(node.Id)) {
            return true;
        }

        return string.Equals(node.Meta?.Kind, "series", StringComparison.OrdinalIgnoreCase);
    }
}
