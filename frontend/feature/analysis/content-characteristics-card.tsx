"use client";

import * as React from "react";

import { MetricTile, MetricTileGrid } from "@/components/metric-tiles";
import { formatNumber, formatPercent } from "@/lib/analysisFormat";
import { populationStdDev } from "@/lib/results/chapter5";
import type { AnalysisSeriesDocument } from "@/lib/videoAnalysisApi";

/** TI below which a frame counts as a repeat. Mirrors `SitiAnalyzer.DuplicateTiThreshold`. */
const DUPLICATE_TI_THRESHOLD = 2;

function mean(values: number[] | undefined): number | null {
  if (!values || values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The video's content row: SI and TI with their spread, repeats and source banding. */
export function ContentCharacteristicsCard({
  series,
  durationSec,
}: {
  series?: AnalysisSeriesDocument;
  durationSec?: number | null;
}) {
  const siti = series?.siti;
  const figures = React.useMemo(
    () => ({
      siMean: mean(siti?.si),
      siSd: siti?.si?.length ? populationStdDev(siti.si) : null,
      tiMean: mean(siti?.ti),
      tiSd: siti?.ti?.length ? populationStdDev(siti.ti) : null,
    }),
    [siti],
  );

  const frames = siti?.si?.length ?? 0;
  const duplicateShare = series?.duplicateFrameShare;
  const sourceCambi = series?.sourceCambi;

  return (
    <div className="space-y-3">
      <MetricTileGrid columns={3} className="lg:grid-cols-6">
        <MetricTile
          value={formatNumber(figures.siMean)}
          label="Mean SI"
          title="Spatial information (ITU-T P.910): edge energy per frame."
        />
        <MetricTile value={formatNumber(figures.siSd)} label="SI SD" />
        <MetricTile
          value={formatNumber(figures.tiMean)}
          label="Mean TI"
          title="Temporal information (ITU-T P.910): difference from the previous frame."
        />
        <MetricTile value={formatNumber(figures.tiSd)} label="TI SD" />
        <MetricTile
          value={duplicateShare != null ? formatPercent(duplicateShare) : "—"}
          label="Duplicate frames"
          title={`Share of frames with TI below ${DUPLICATE_TI_THRESHOLD}.`}
        />
        <MetricTile
          value={formatNumber(sourceCambi)}
          label="Source CAMBI"
          title={
            series?.sourceCambiMax != null
              ? `Banding already in the source, 0 is none. Worst frame ${formatNumber(series.sourceCambiMax)}.`
              : "Banding already in the source, 0 is none."
          }
        />
      </MetricTileGrid>
      <p className="text-xs text-muted-foreground">
        Measured on the source before encoding
        {frames > 0 ? `, ${frames.toLocaleString("en")} frames` : ""}
        {durationSec != null ? ` over ${durationSec.toFixed(1)} s` : ""}. SD is over every frame.
      </p>
    </div>
  );
}
