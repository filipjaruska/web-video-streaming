import type { AnalysisTreeNode } from "@/lib/videoAnalysisApi";

const deprecatedNodeIds = new Set([
  "general.encoded_date",
  "general.tagged_date",
  "siti.frames",
]);

function isDeprecated(node: AnalysisTreeNode): boolean {
  if (deprecatedNodeIds.has(node.id)) {
    return true;
  }

  return node.meta?.kind === "series";
}

function normalizeNode(node: AnalysisTreeNode): AnalysisTreeNode | null {
  if (isDeprecated(node)) {
    return null;
  }

  const children = normalizeAnalysisTreeNodes(node.children ?? []);
  const isEmptyLeaf =
    (node.children?.length ?? 0) === 0 &&
    (node.value == null || node.value.trim() === "") &&
    node.meta?.kind !== "section";

  if (isEmptyLeaf) {
    return null;
  }

  return {
    ...node,
    children: children.length > 0 ? children : undefined,
  };
}

export function normalizeAnalysisTreeNodes(
  nodes: AnalysisTreeNode[],
): AnalysisTreeNode[] {
  return nodes
    .map((node) => normalizeNode(node))
    .filter((node): node is AnalysisTreeNode => node != null);
}

/** Media metadata only — SI/TI lives in the over-time chart card. */
export function splitSourceAnalysisTree(nodes: AnalysisTreeNode[]): {
  mediaNodes: AnalysisTreeNode[];
  sitiNode: AnalysisTreeNode | undefined;
} {
  const normalized = normalizeAnalysisTreeNodes(nodes);
  return {
    mediaNodes: normalized.filter((node) => node.id !== "siti"),
    sitiNode: normalized.find((node) => node.id === "siti"),
  };
}
