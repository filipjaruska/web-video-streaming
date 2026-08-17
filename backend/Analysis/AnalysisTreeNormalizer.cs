namespace WebWVideoStreamingAPI.Analysis;

/// <summary>
/// Applied on every read so stored documents from older runs still render: drops retired node ids,
/// drops leaves that carry neither a value nor children, and drops the legacy "series" node kind.
/// </summary>
public static class AnalysisTreeNormalizer {
    private static readonly HashSet<string> RetiredNodeIds = new(StringComparer.OrdinalIgnoreCase) {
        "general.encoded_date",
        "general.tagged_date",
        "siti.frames"
    };

    public static AnalysisTreeDocument Normalize(AnalysisTreeDocument tree) {
        return new AnalysisTreeDocument {
            Id = tree.Id,
            Label = tree.Label,
            Children = NormalizeNodes(tree.Children)
        };
    }

    private static List<AnalysisTreeNode> NormalizeNodes(IEnumerable<AnalysisTreeNode>? nodes) {
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
        if (IsRetired(node)) {
            return null;
        }

        var children = NormalizeNodes(node.Children);
        var isEmptyLeaf = (node.Children == null || node.Children.Count == 0) &&
                          string.IsNullOrWhiteSpace(node.Value);

        // Sections survive while empty — they carry status and are the tree's structure.
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

    private static bool IsRetired(AnalysisTreeNode node) {
        return RetiredNodeIds.Contains(node.Id) ||
               string.Equals(node.Meta?.Kind, "series", StringComparison.OrdinalIgnoreCase);
    }
}
