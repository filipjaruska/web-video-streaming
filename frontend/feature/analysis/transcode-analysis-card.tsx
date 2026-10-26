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
import { ChevronRight } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ladderLongLabel } from "@/lib/analysisFormat";
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
  /** The rung `videoSrc` plays, for its label. */
  previewRung?: string;
}

function sectionStatusBadge(status?: AnalysisSectionStatus) {
  return status ? <StatusBadge status={status} /> : null;
}

function labelHeight(label: string) {
  const match = label.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function sortRenditionLabels(labels: string[]) {
  return labels.toSorted((a, b) => labelHeight(b) - labelHeight(a));
}

function FormatSitiCharts({
  formatLabel,
  sitiByRendition,
  videoSrc,
  previewRung = "360p",
}: {
  formatLabel: string;
  sitiByRendition: Record<string, SitiSeriesData>;
  videoSrc?: string;
  /** The rung `videoSrc` plays, for its label. */
  previewRung?: string;
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
          title={`${formatLabel} ${active}: SI and TI over time`}
          note={`ITU-T P.910, per frame of the ${active} rendition.`}
          videoSrc={videoSrc}
          videoLabel={`Scene reference (HLS ${previewRung})`}
        />
      )}
    </div>
  );
}

function FormatBox({
  section,
  sitiByRendition,
  videoSrc,
  previewRung = "360p",
}: {
  section: AnalysisTreeNode;
  sitiByRendition?: Record<string, SitiSeriesData>;
  videoSrc?: string;
  /** The rung `videoSrc` plays, for its label. */
  previewRung?: string;
}) {
  const hasTree = (section.children?.length ?? 0) > 0;
  const hasSiti = !!sitiByRendition && Object.keys(sitiByRendition).length > 0;

  return (
    <div className="rounded-sm border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h4 className="text-sm font-medium">{section.label}</h4>
        {sectionStatusBadge(section.meta?.status)}
      </div>
      <div className="px-3 py-2">
        {section.meta?.error && (
          <p className="mb-2 text-sm text-muted-foreground">{section.meta.error}</p>
        )}
        {hasTree ? (
          <AnalysisTree nodes={section.children!} />
        ) : (
          !section.meta?.error && <p className="text-sm text-muted-foreground">Not probed yet.</p>
        )}
        {hasSiti && (
          <FormatSitiCharts
            formatLabel={section.label}
            sitiByRendition={sitiByRendition}
            videoSrc={videoSrc}
            previewRung={previewRung}
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
  previewRung = "360p",
}: TranscodeAnalysisCardProps) {
  const [open, setOpen] = useState(false);
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
    (box): box is { section: AnalysisTreeNode; siti: typeof box.siti } => box.section != null,
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-sm border">
      <CollapsibleTrigger className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40">
        <span className="flex items-center gap-2 font-medium">
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          {target.ladderKind ? ladderLongLabel(target.ladderKind) : `Run ${transcodeNumber}`}
          {isActive ? " (active)" : ""}
          <span className="text-sm font-normal text-muted-foreground">{createdLabel}</span>
        </span>
        <StatusBadge status={target.status} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t px-4 py-4">
        {boxes.length > 0 ? (
          boxes.map(({ section, siti }) => (
            <FormatBox
              key={section.id}
              section={section}
              sitiByRendition={siti}
              videoSrc={videoSrc}
              previewRung={previewRung}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No HLS or DASH probe for this run.</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
