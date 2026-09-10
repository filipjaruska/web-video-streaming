"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataCell, DataRow, DataTable } from "@/components/ui/data-table";
import { MetricTile, MetricTileGrid } from "@/components/metric-tiles";
import { ExportCsvButton } from "@/components/export-csv-button";
import { slugFilename } from "@/lib/csvExport";
import type { VideoTranscodeListItem } from "@/lib/videoTranscodesApi";

export interface PipelineStage {
  name: string;
  seconds: number | null;
  detail?: string;
}

function seconds(from?: string | null, to?: string | null): number | null {
  if (!from || !to) {
    return null;
  }

  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  return (end - start) / 1000;
}

function formatSeconds(value: number | null): string {
  if (value == null) {
    return "—";
  }

  if (value < 90) {
    return `${value.toFixed(1)} s`;
  }

  const minutes = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return `${minutes}m ${rest.toString().padStart(2, "0")}s`;
}

/**
 * Derives per-stage durations from the packaging runs.
 *
 * The pipeline is strictly sequential: it packages the static ladder, then for each derived ladder
 * runs an encode grid, derives, and packages. So the gap between one run finishing and the next
 * being created is exactly the grid and derivation that produced the next one — no separate
 * instrumentation needed. If the derived passes were ever parallelised this attribution would stop
 * holding, which is why it is stated here rather than assumed.
 */
export function buildStages(
  transcodes: VideoTranscodeListItem[],
  gridSizes: { generic: number; animation: number },
): PipelineStage[] {
  const ordered = transcodes
    .slice()
    .sort(
      (a, b) =>
        new Date(a.createdAtUtc).getTime() - new Date(b.createdAtUtc).getTime(),
    );

  const byKind = (kind: string) => ordered.find((item) => item.ladderKind === kind);
  const staticRun = byKind("static");
  const dynamicRun = byKind("dynamic");
  const animationRun = byKind("animation");

  const stages: PipelineStage[] = [];

  stages.push({
    name: "Static packaging + analysis",
    seconds: seconds(staticRun?.startedAtUtc, staticRun?.completedAtUtc),
    detail: "Baseline ladder, encoded straight from the fixed table.",
  });

  stages.push({
    name: "Generic encode grid + derivation",
    seconds: seconds(staticRun?.completedAtUtc, dynamicRun?.createdAtUtc),
    detail:
      gridSizes.generic > 0
        ? `${gridSizes.generic} trial encodes, each scored against the source.`
        : "Trial encodes across resolution × CRF, each scored against the source.",
  });

  stages.push({
    name: "Dynamic packaging + analysis",
    seconds: seconds(dynamicRun?.startedAtUtc, dynamicRun?.completedAtUtc),
  });

  stages.push({
    name: "Animation encode grid + derivation",
    seconds: seconds(dynamicRun?.completedAtUtc, animationRun?.createdAtUtc),
    detail:
      gridSizes.animation > 0
        ? `${gridSizes.animation} trial encodes under the animation tune.`
        : "Second sweep under the animation encoder settings.",
  });

  stages.push({
    name: "Animation packaging + analysis",
    seconds: seconds(animationRun?.startedAtUtc, animationRun?.completedAtUtc),
  });

  return stages;
}

/**
 * What content adaptation costs, against what it saved.
 *
 * A static ladder is a lookup table; both derived ladders require a per-clip sweep of trial
 * encodes, each with a full-reference VMAF score. Whether that is worth paying is a question the
 * ladder comparison cannot answer on its own.
 */
export function PipelineCostCard({
  transcodes,
  gridSizes,
  sourceDurationSec,
}: {
  transcodes: VideoTranscodeListItem[];
  gridSizes: { generic: number; animation: number };
  sourceDurationSec?: number | null;
}) {
  const stages = React.useMemo(
    () => buildStages(transcodes, gridSizes),
    [transcodes, gridSizes],
  );

  const measured = stages.filter((stage) => stage.seconds != null);
  const total = measured.reduce((sum, stage) => sum + (stage.seconds ?? 0), 0);

  const adaptiveOnly = stages
    .slice(1)
    .reduce((sum, stage) => sum + (stage.seconds ?? 0), 0);

  const staticOnly = stages[0]?.seconds ?? null;

  const realtimeFactor =
    sourceDurationSec && sourceDurationSec > 0 && total > 0
      ? total / sourceDurationSec
      : null;

  const overheadFactor =
    staticOnly && staticOnly > 0 && adaptiveOnly > 0
      ? (staticOnly + adaptiveOnly) / staticOnly
      : null;

  const exportRows = React.useMemo(
    () => stages.map((stage) => [stage.name, stage.seconds ?? ""]),
    [stages],
  );

  if (measured.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline cost</CardTitle>
          <CardDescription>
            Derived from packaging-run timestamps. Runs processed before these were recorded do
            not carry them, so re-processing this video will populate this view.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Pipeline cost</CardTitle>
            <CardDescription>
              Derived from packaging-run timestamps. The pipeline runs strictly in sequence, so
              the gap between one run finishing and the next beginning is the encode grid and
              derivation that produced it.
            </CardDescription>
          </div>
          <ExportCsvButton
            filename={slugFilename(["pipeline-cost"])}
            headers={["stage", "seconds"]}
            rows={exportRows}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <MetricTileGrid columns={4}>
          <MetricTile value={formatSeconds(total)} label="Total measured" />
          <MetricTile
            value={formatSeconds(staticOnly)}
            label="Static ladder alone"
            title="What a fixed-table ladder costs — the baseline the adaptive work is charged against."
          />
          <MetricTile
            value={overheadFactor != null ? `${overheadFactor.toFixed(1)}×` : "—"}
            label="Cost vs static only"
            title="Total processing divided by what the static ladder alone would have cost."
          />
          <MetricTile
            value={
              realtimeFactor != null ? `${realtimeFactor.toFixed(1)}×` : "—"
            }
            label="Of clip duration"
            title="Total processing time relative to the length of the source clip."
          />
        </MetricTileGrid>

        <DataTable headers={["Stage", "Duration", "Notes"]}>
          {stages.map((stage) => (
            <DataRow key={stage.name}>
              <DataCell mono={false}>{stage.name}</DataCell>
              <DataCell>{formatSeconds(stage.seconds)}</DataCell>
              <DataCell mono={false} last className="text-muted-foreground">
                {stage.detail ?? ""}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      </CardContent>
    </Card>
  );
}
