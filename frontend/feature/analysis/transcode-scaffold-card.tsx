"use client";

import type { AnalysisTarget, AnalysisTreeNode } from "@/lib/videoAnalysisApi";
import { AnalysisTree } from "@/feature/analysis/analysis-tree";
import { formatTargetStatus } from "@/lib/analysisLabels";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface TranscodeScaffoldCardProps {
  target: AnalysisTarget;
  transcodeNumber: number;
}

function FormatBox({ section }: { section: AnalysisTreeNode }) {
  const hasTree = (section.children?.length ?? 0) > 0;

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h4 className="text-sm font-medium">{section.label}</h4>
        <Badge variant="secondary">Temp scaffold</Badge>
      </div>
      <div className="px-3 py-2">
        {section.meta?.error && (
          <p className="mb-2 text-sm text-muted-foreground">
            {section.meta.error}
          </p>
        )}
        {hasTree ? (
          <AnalysisTree nodes={section.children!} defaultOpen />
        ) : (
          !section.meta?.error && (
            <p className="text-sm text-muted-foreground">
              No scaffold data for this format.
            </p>
          )
        )}
      </div>
    </div>
  );
}

export function TranscodeScaffoldCard({
  target,
  transcodeNumber,
}: TranscodeScaffoldCardProps) {
  const isActive = target.label.includes("(active)");
  const hls = target.tree.children.find((child) => child.id === "hls");
  const dash = target.tree.children.find((child) => child.id === "dash");
  const sections = [hls, dash].filter(
    (section): section is AnalysisTreeNode => section != null,
  );

  const createdLabel = target.label
    .replace(/^Transcode ·\s*/i, "")
    .replace(/^Attempt ·\s*/i, "")
    .replace(/\s*\(active\)\s*$/i, "");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Transcode {transcodeNumber}
              {isActive ? " · active" : ""}
            </CardTitle>
            <CardDescription>
              {createdLabel}. HLS and DASH boxes below use temporary placeholder
              metadata ([temp]) until real probes are implemented.
            </CardDescription>
          </div>
          <Badge variant="outline">{formatTargetStatus(target.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sections.length > 0 ? (
          sections.map((section) => (
            <FormatBox key={section.id} section={section} />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No HLS/DASH scaffolds for this packaging run.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
