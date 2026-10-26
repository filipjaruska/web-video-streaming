"use client";

import * as React from "react";

import { EmptyState } from "@/components/empty-state";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Figure } from "@/components/figure";
import { MetricTile, MetricTileGrid } from "@/components/metric-tiles";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import { slugFilename } from "@/lib/csvExport";
import { PIPELINE_PHASES } from "@/lib/pipelineSteps";
import type { OverheadRow } from "@/lib/results/chapter5";
import { multiple } from "@/lib/results/format";
import type { StageTiming } from "@/lib/videoAnalysisApi";

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 90) {
    return `${seconds.toFixed(1)} s`;
  }
  // Rounded before splitting, so 119.6 s reads "2 min 00 s" rather than "1 min 60 s".
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)} min ${(whole % 60).toString().padStart(2, "0")} s`;
}

/**
 * Where the processing time went: the clip's row of Table 8, then every step. Multiples are of
 * encoding and packaging the static ladder, the cost of a fixed ladder.
 */
export function PipelineCostCard({
  timings,
  overhead,
  sourceDurationSec,
}: {
  timings?: Record<string, StageTiming>;
  overhead?: OverheadRow;
  sourceDurationSec?: number | null;
}) {
  const base = (timings?.StaticEncode?.durationMs ?? 0) + (timings?.StaticPackage?.durationMs ?? 0);

  const rows = React.useMemo(
    () =>
      PIPELINE_PHASES.flatMap((phase) =>
        phase.steps.flatMap((step) => {
          const timing = timings?.[step.key];
          return timing ? [{ phase: phase.label, step: step.label, key: step.key, timing }] : [];
        }),
      ),
    [timings],
  );

  if (!timings || rows.length === 0) {
    return (
      <EmptyState title="No step timings">
        Clips processed before timings were recorded do not have them.
      </EmptyState>
    );
  }

  const totalMs = rows.reduce((sum, row) => sum + row.timing.durationMs, 0);

  return (
    <>
      <MetricTileGrid columns={5}>
        <MetricTile value={multiple(overhead?.defaultGrid)} label="Default grid" />
        <MetricTile value={multiple(overhead?.tunedGrid)} label="Tuned grid" />
        <MetricTile
          value={multiple(overhead?.ladderEncode)}
          label="Ladder encode and package"
          title="Encoding and packaging the animation-optimised ladder."
        />
        <MetricTile
          value={multiple(overhead?.productionPath)}
          label="Production path"
          title="Both grids, the derivation, and encoding and packaging the animation-optimised ladder. Analysing the packaged rungs serves only the measurement and is left out."
        />
        <MetricTile
          value={sourceDurationSec ? `${(totalMs / 1000 / sourceDurationSec).toFixed(0)}×` : "—"}
          label="All steps, of clip length"
        />
      </MetricTileGrid>

      <Figure
        title="Every processing step"
        note={`Multiples of encoding and packaging the static ladder (${formatDuration(base)}). Count is grid samples for a grid, rungs for an encode.`}
        actions={
          <ExportCsvButton
            filename={slugFilename(["pipeline-steps"])}
            headers={["phase", "step", "duration_ms", "count", "frames"]}
            rows={rows.map((row) => [
              row.phase,
              row.key,
              row.timing.durationMs,
              row.timing.count ?? "",
              row.timing.frames ?? "",
            ])}
          />
        }
      >
        <DataTable
          head={
            <tr className="border-b border-foreground/20">
              <DataHead>Phase</DataHead>
              <DataHead>Step</DataHead>
              <DataHead numeric>Duration</DataHead>
              <DataHead numeric>× static</DataHead>
              <DataHead numeric>Count</DataHead>
            </tr>
          }
        >
          {rows.map((row, index) => (
            <DataRow key={row.key}>
              <DataCell mono={false} className="font-medium whitespace-nowrap">
                {index === 0 || rows[index - 1].phase !== row.phase ? row.phase : ""}
              </DataCell>
              <DataCell mono={false}>{row.step}</DataCell>
              <DataCell numeric>{formatDuration(row.timing.durationMs)}</DataCell>
              <DataCell numeric>{base > 0 ? multiple(row.timing.durationMs / base) : "—"}</DataCell>
              <DataCell numeric last>
                {row.timing.count ?? ""}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      </Figure>
    </>
  );
}
