"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AnalysisTreeNode } from "@/lib/videoAnalysisApi";
import { normalizeAnalysisTreeNodes } from "@/lib/analysisTree";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface AnalysisTreeProps {
  nodes: AnalysisTreeNode[];
  defaultOpen?: boolean;
}

function statusBadge(status?: string) {
  switch (status) {
    case "running":
      return <Badge variant="secondary">Running</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
    default:
      return null;
  }
}

function AnalysisTreeNodeView({
  node,
  defaultOpen = false,
  depth = 0,
}: {
  node: AnalysisTreeNode;
  defaultOpen?: boolean;
  depth?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isLeaf = node.value != null && node.value !== "";
  const hasChildren = (node.children?.length ?? 0) > 0;

  if (isLeaf && !hasChildren) {
    return (
      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 border-b border-border/50 py-1.5 text-sm last:border-b-0",
          depth > 0 && "pl-4",
        )}
      >
        <span className="text-muted-foreground">{node.label}</span>
        <span className="break-all font-mono text-xs">{node.value}</span>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn(depth > 0 && "ml-2")}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-left text-sm font-medium">
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        {node.label}
        {statusBadge(node.meta?.status)}
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-2 pl-6">
        {node.meta?.error && (
          <p className="mb-2 text-sm text-destructive">{node.meta.error}</p>
        )}
        {node.children?.map((child) => (
          <AnalysisTreeNodeView
            key={child.id}
            node={child}
            depth={depth + 1}
          />
        ))}
        {!hasChildren && node.meta?.status === "running" && (
          <p className="text-sm text-muted-foreground">Analysis in progress…</p>
        )}
        {!hasChildren && node.meta?.status === "pending" && !node.meta?.error && (
          <p className="text-sm text-muted-foreground">Not run yet.</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AnalysisTree({
  nodes,
  defaultOpen = false,
}: AnalysisTreeProps) {
  const normalizedNodes = useMemo(
    () => normalizeAnalysisTreeNodes(nodes),
    [nodes],
  );

  if (normalizedNodes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No analysis data yet. Processing may still be running.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {normalizedNodes.map((node, index) => (
        <AnalysisTreeNodeView
          key={node.id}
          node={node}
          defaultOpen={defaultOpen || index === 0}
        />
      ))}
    </div>
  );
}
