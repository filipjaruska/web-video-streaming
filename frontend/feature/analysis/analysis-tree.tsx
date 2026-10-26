"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import { normalizeAnalysisTreeNodes } from "@/lib/analysisTree";
import { cn } from "@/lib/utils";
import type { AnalysisTreeNode } from "@/lib/videoAnalysisApi";

interface AnalysisTreeProps {
  nodes: AnalysisTreeNode[];
}

/** Groups up to this many rows start open; longer ones start collapsed. */
const OPEN_BY_DEFAULT_ROWS = 8;

/** "1080p video packets", "720p-700k Average SI": a rung label, then what was measured. */
const RUNG_ROW = /^(\d{3,4}p(?:-\d+k)?) (.+)$/;

/** Rates arrive from the backend in kb/s; the app gives every rate in Mb/s. */
function formatValue(value: string): string {
  return value.replace(/(\d+(?:\.\d+)?) kb\/s/g, (_, kbps: string) => {
    const mbps = Number(kbps) / 1000;
    return `${mbps.toFixed(mbps < 0.1 ? 3 : 2)} Mb/s`;
  });
}

function statusBadge(status?: string) {
  return status && status !== "completed" ? <StatusBadge status={status} /> : null;
}

function leafCount(node: AnalysisTreeNode): number {
  return (node.children ?? []).reduce(
    (count, child) => count + (child.children?.length ? leafCount(child) : 1),
    0,
  );
}

/**
 * Splits a group's rows into a rung × measure table and the rows that are not per rung. Pivots only
 * when at least two rungs share at least two measures, so a short list stays a list.
 */
function pivotRungRows(rows: AnalysisTreeNode[]) {
  const rungs: string[] = [];
  const measures: string[] = [];
  const cells = new Map<string, string>();
  const rest: AnalysisTreeNode[] = [];

  for (const row of rows) {
    const match = RUNG_ROW.exec(row.label);
    if (!match || row.children?.length) {
      rest.push(row);
      continue;
    }
    const [, rung, measure] = match;
    if (!rungs.includes(rung)) rungs.push(rung);
    if (!measures.includes(measure)) measures.push(measure);
    cells.set(`${rung}\u0000${measure}`, row.value ?? "");
  }

  if (rungs.length < 2 || measures.length < 2) {
    return { table: null, rest: rows };
  }
  return { table: { rungs, measures, cells }, rest };
}

function LeafRow({ node }: { node: AnalysisTreeNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 px-2 py-1.5 text-sm odd:bg-muted/40">
      <span className="text-foreground/75">{node.label}</span>
      <span className="font-mono text-xs leading-5 break-all text-foreground tabular">
        {formatValue(node.value ?? "")}
      </span>
    </div>
  );
}

function GroupBody({ node, depth }: { node: AnalysisTreeNode; depth: number }) {
  const children = node.children ?? [];
  const leaves = children.filter((child) => !child.children?.length);
  const groups = children.filter((child) => child.children?.length);
  const { table, rest } = pivotRungRows(leaves);

  return (
    <div className="space-y-3">
      {node.meta?.error && <p className="text-sm text-destructive">{node.meta.error}</p>}
      {table && (
        <DataTable
          head={
            <tr className="border-b border-foreground/20">
              <DataHead>Rung</DataHead>
              {table.measures.map((measure) => (
                <DataHead key={measure} numeric>
                  {measure}
                </DataHead>
              ))}
            </tr>
          }
        >
          {table.rungs.map((rung) => (
            <DataRow key={rung}>
              <DataCell className="font-medium">{rung}</DataCell>
              {table.measures.map((measure) => (
                <DataCell key={measure} numeric>
                  {formatValue(table.cells.get(`${rung}\u0000${measure}`) ?? "—")}
                </DataCell>
              ))}
            </DataRow>
          ))}
        </DataTable>
      )}
      {rest.length > 0 && (
        <div className="overflow-hidden rounded-sm border">
          {rest.map((child) => (
            <LeafRow key={child.id} node={child} />
          ))}
        </div>
      )}
      {groups.map((child) => (
        <TreeGroup key={child.id} node={child} depth={depth + 1} />
      ))}
      {children.length === 0 && node.meta?.status === "running" && (
        <p className="text-sm text-muted-foreground">Analysis in progress…</p>
      )}
      {children.length === 0 && node.meta?.status === "pending" && !node.meta?.error && (
        <p className="text-sm text-muted-foreground">Not run yet.</p>
      )}
    </div>
  );
}

function TreeGroup({ node, depth }: { node: AnalysisTreeNode; depth: number }) {
  const count = leafCount(node);
  const [open, setOpen] = useState(count > 0 && count <= OPEN_BY_DEFAULT_ROWS);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn(depth > 0 && "border-l pl-4")}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-left text-sm font-medium transition-colors hover:text-primary-ink">
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span>{node.label}</span>
        {count > 0 && (
          <span className="font-mono text-xs font-normal text-muted-foreground tabular">
            {count}
          </span>
        )}
        {statusBadge(node.meta?.status)}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-3 pl-6">
        <GroupBody node={node} depth={depth} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Metadata as the backend recorded it, as collapsible groups. Short groups start open, long ones
 * collapsed; per-rung lists are shown as one table per group.
 */
export function AnalysisTree({ nodes }: AnalysisTreeProps) {
  const normalizedNodes = useMemo(() => normalizeAnalysisTreeNodes(nodes), [nodes]);

  if (normalizedNodes.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>;
  }

  const leaves = normalizedNodes.filter((node) => !node.children?.length);
  return (
    <div className="divide-y">
      {leaves.length > 0 && (
        <div className="overflow-hidden rounded-sm border">
          {leaves.map((node) => (
            <LeafRow key={node.id} node={node} />
          ))}
        </div>
      )}
      {normalizedNodes
        .filter((node) => node.children?.length)
        .map((node) => (
          <TreeGroup key={node.id} node={node} depth={0} />
        ))}
    </div>
  );
}
