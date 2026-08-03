"use client";

import { useMemo, useState } from "react";
import type {
  AnalysisSectionStatus,
  AnalysisTarget,
  AnalysisTreeNode,
  SitiSeriesData,
} from "@/lib/videoAnalysisApi";
import { AnalysisTree } from "@/feature/analysis/analysis-tree";
import { SitiChart } from "@/feature/analysis/siti-chart";
import { formatTargetStatus } from "@/lib/analysisLabels";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TranscodeAnalysisCardProps {
  target: AnalysisTarget;
  transcodeNumber: number;
  /** Progressive source MP4 — used as a scene-time reference for SI/TI scrubbing. */
  videoSrc?: string;
}

function sectionStatusBadge(status?: AnalysisSectionStatus) {
  switch (status) {
    case "running":
      return <Badge variant="secondary">Running</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
    case "completed":
      return <Badge variant="outline">Completed</Badge>;
    case "notImplemented":
      return <Badge variant="secondary">Not implemented</Badge>;
    default:
      return null;
  }
}

function sortRenditionLabels(labels: string[]) {
  return [...labels].sort((a, b) => {
    const height = (label: string) => {
      const match = label.match(/(\d+)/);
      return match ? Number(match[1]) : 0;
    };
    return height(b) - height(a);
  });
}

function FormatSitiCharts({
  formatLabel,
  sitiByRendition,
  videoSrc,
}: {
  formatLabel: string;
  sitiByRendition: Record<string, SitiSeriesData>;
  videoSrc?: string;
}) {
  const labels = useMemo(
    () => sortRenditionLabels(Object.keys(sitiByRendition)),
    [sitiByRendition],
  );

  const [selected, setSelected] = useState(labels[0] ?? "");
  const series = selected ? sitiByRendition[selected] : undefined;

  if (labels.length === 0) {
    return null;
  }

  const active = labels.includes(selected) ? selected : labels[0];
  const activeSeries = sitiByRendition[active] ?? series;

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-sm font-medium">{formatLabel} SI/TI by ladder rung</h4>
        <Select value={active} onValueChange={setSelected}>
          <SelectTrigger className="w-35">
            <SelectValue placeholder="Rendition" />
          </SelectTrigger>
          <SelectContent>
            {labels.map((label) => (
              <SelectItem key={label} value={label}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {activeSeries && (
        <SitiChart
          data={activeSeries}
          title={`${formatLabel} · ${active} SI/TI`}
          description={`Spatial and temporal information (ITU-T P.910) for the ${active} ${formatLabel} rendition.`}
          videoSrc={videoSrc}
          videoLabel="Scene reference (HLS 360p)"
        />
      )}
    </div>
  );
}

function FormatBox({
  section,
  sitiByRendition,
  videoSrc,
}: {
  section: AnalysisTreeNode;
  sitiByRendition?: Record<string, SitiSeriesData>;
  videoSrc?: string;
}) {
  const hasTree = (section.children?.length ?? 0) > 0;
  const hasSiti =
    !!sitiByRendition && Object.keys(sitiByRendition).length > 0;

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h4 className="text-sm font-medium">{section.label}</h4>
        {sectionStatusBadge(section.meta?.status)}
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
              No analysis data for this format yet.
            </p>
          )
        )}
        {hasSiti && (
          <FormatSitiCharts
            formatLabel={section.label}
            sitiByRendition={sitiByRendition}
            videoSrc={videoSrc}
          />
        )}
      </div>
    </div>
  );
}

export function TranscodeAnalysisCard({
  target,
  transcodeNumber,
  videoSrc,
}: TranscodeAnalysisCardProps) {
  const isActive = target.label.includes("(active)");
  const hls = target.tree.children.find((child) => child.id === "hls");
  const dash = target.tree.children.find((child) => child.id === "dash");

  const createdLabel = target.label
    .replace(/^Transcode ·\s*/i, "")
    .replace(/^Attempt ·\s*/i, "")
    .replace(/\s*\(active\)\s*$/i, "");

  const sitiByFormat = target.series.sitiByFormat;
  const boxes = [
    { section: hls, siti: sitiByFormat?.hls },
    { section: dash, siti: sitiByFormat?.dash },
  ].filter(
    (box): box is { section: AnalysisTreeNode; siti: typeof box.siti } =>
      box.section != null,
  );

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
              {createdLabel}. Probe metadata and per-format SI/TI from the
              packaged HLS and DASH outputs.
            </CardDescription>
          </div>
          <Badge variant="outline">{formatTargetStatus(target.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {boxes.length > 0 ? (
          boxes.map(({ section, siti }) => (
            <FormatBox
              key={section.id}
              section={section}
              sitiByRendition={siti}
              videoSrc={videoSrc}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No HLS/DASH analysis for this packaging run.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
