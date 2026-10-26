"use client";

import * as React from "react";

import { EmptyState } from "@/components/empty-state";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Figure } from "@/components/figure";
import { MetricTile, MetricTileGrid, toneForGain, toneForSaving } from "@/components/metric-tiles";
import { DataCell, DataRow, DataTable } from "@/components/ui/data-table";
import { TuningByCrfChart } from "@/feature/results/results-charts";
import { formatBitrate, formatNumber } from "@/lib/analysisFormat";
import { slugFilename } from "@/lib/csvExport";
import type { TuningCrfSeries } from "@/lib/results/chapter5";
import { signed } from "@/lib/results/format";
import type { TuningComparisonDocument } from "@/lib/videoAnalysisApi";

/**
 * Default x264 against `-tune animation` on this clip: its row of Table 7, its Graphs 3 and 4, and
 * the matched samples behind them. A pair shares resolution and CRF, so only the settings differ.
 */
export function TuningComparisonCard({
  tuning,
  byCrf,
}: {
  tuning?: TuningComparisonDocument;
  /** Per-CRF means over resolutions, as on the results page. */
  byCrf?: TuningCrfSeries;
}) {
  const pairs = React.useMemo(() => tuning?.pairs ?? [], [tuning]);

  const exportRows = React.useMemo(
    () =>
      pairs.map((pair) => [
        pair.label,
        pair.height,
        pair.crf,
        pair.baseVmaf,
        pair.tunedVmaf,
        pair.vmafDelta,
        pair.baseCambi ?? "",
        pair.tunedCambi ?? "",
        pair.baseCambi != null && pair.tunedCambi != null ? pair.tunedCambi - pair.baseCambi : "",
        pair.baseBitrateBps,
        pair.tunedBitrateBps,
      ]),
    [pairs],
  );

  if (!tuning || tuning.error || pairs.length === 0) {
    return (
      <EmptyState title="Not compared yet">
        {tuning?.error ?? "The comparison needs both encode grids."}
      </EmptyState>
    );
  }

  const perResolution = Object.entries(tuning.bdRateByResolution ?? {}).toSorted(
    ([a], [b]) => Number.parseInt(b, 10) - Number.parseInt(a, 10),
  );
  const series = byCrf && byCrf.points.length > 0 ? [byCrf] : [];

  return (
    <>
      <div className="space-y-3">
        <MetricTileGrid columns={4}>
          <MetricTile value={pairs.length} label="Matched pairs" />
          <MetricTile
            value={signed(tuning.meanVmafDelta, 3)}
            label="Mean ΔVMAF"
            tone={toneForGain(tuning.meanVmafDelta)}
          />
          <MetricTile
            value={signed(tuning.meanCambiDelta, 3)}
            label="Mean ΔCAMBI"
            tone={toneForSaving(tuning.meanCambiDelta)}
            title="Positive is more banding with tuning."
          />
          <MetricTile
            value={signed(tuning.bdRatePercent)}
            unit="%"
            label="BD-rate, mean over resolutions"
            tone={toneForSaving(tuning.bdRatePercent)}
          />
        </MetricTileGrid>
        {perResolution.length > 0 && (
          <p className="text-xs text-muted-foreground">
            BD-rate per resolution:{" "}
            <span className="font-mono tabular text-foreground">
              {perResolution.map(([label, value]) => `${label} ${signed(value)}`).join(" · ")}
            </span>
            . Tuned minus default, <code className="font-mono">-tune {tuning.tune}</code>
            {tuning.decimate ? " with mpdecimate" : ""}. Each resolution is fitted on its own
            (Akima).
          </p>
        )}
      </div>

      {series.length > 0 && (
        <div className="grid gap-8 lg:grid-cols-2">
          <Figure title="ΔVMAF against CRF" note="Mean over the resolutions at each CRF.">
            <TuningByCrfChart series={series} metric="vmafDelta" />
          </Figure>
          <Figure title="ΔCAMBI against CRF" note="Positive means more banding with tuning.">
            <TuningByCrfChart series={series} metric="cambiDelta" />
          </Figure>
        </div>
      )}

      <details className="group">
        <summary className="cursor-pointer text-sm font-medium select-none">
          Matched samples ({pairs.length})
        </summary>
        <div className="mt-4">
          <Figure
            title="Every sample present in both grids"
            actions={
              <ExportCsvButton
                filename={slugFilename(["tuning", tuning.tune ?? "animation"])}
                headers={[
                  "rung",
                  "height",
                  "crf",
                  "base_vmaf",
                  "tuned_vmaf",
                  "vmaf_delta",
                  "base_cambi",
                  "tuned_cambi",
                  "cambi_delta",
                  "base_bitrate_bps",
                  "tuned_bitrate_bps",
                ]}
                rows={exportRows}
              />
            }
          >
            <DataTable
              headers={[
                "Rung",
                "CRF",
                "Default VMAF",
                "Tuned VMAF",
                "ΔVMAF",
                "ΔCAMBI",
                "Default bitrate",
                "Tuned bitrate",
              ]}
            >
              {pairs.map((pair) => (
                <DataRow key={`${pair.label}-${pair.crf}`}>
                  <DataCell>{pair.label}</DataCell>
                  <DataCell>{pair.crf}</DataCell>
                  <DataCell numeric>{formatNumber(pair.baseVmaf)}</DataCell>
                  <DataCell numeric>{formatNumber(pair.tunedVmaf)}</DataCell>
                  <DataCell numeric>{signed(pair.vmafDelta)}</DataCell>
                  <DataCell numeric>
                    {pair.baseCambi != null && pair.tunedCambi != null
                      ? signed(pair.tunedCambi - pair.baseCambi)
                      : "—"}
                  </DataCell>
                  <DataCell numeric>{formatBitrate(pair.baseBitrateBps)}</DataCell>
                  <DataCell numeric last>
                    {formatBitrate(pair.tunedBitrateBps)}
                  </DataCell>
                </DataRow>
              ))}
            </DataTable>
          </Figure>
        </div>
      </details>
    </>
  );
}
