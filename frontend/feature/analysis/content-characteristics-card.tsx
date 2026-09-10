"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MetricTile, MetricTileGrid } from "@/components/metric-tiles";
import { formatNumber, formatPercent } from "@/lib/analysisFormat";
import type { AnalysisSeriesDocument } from "@/lib/videoAnalysisApi";

function mean(values: number[] | undefined): number | null {
  if (!values || values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The clip's own characteristics, before any encoding.
 *
 * This is the reference frame every later measurement is read against: a ladder saving is only
 * interpretable next to how compressible the content was to begin with. Duplicate-frame share is
 * promoted here from the raw SI/TI stats list because for animation it is a headline number, not
 * a footnote — it is what "shot on twos" looks like in the signal.
 */
export function ContentCharacteristicsCard({
  series,
  durationSec,
}: {
  series?: AnalysisSeriesDocument;
  durationSec?: number | null;
}) {
  const siti = series?.siti;
  const meanSi = React.useMemo(() => mean(siti?.si), [siti]);
  const meanTi = React.useMemo(() => mean(siti?.ti), [siti]);

  const duplicateShare = series?.duplicateFrameShare;
  const frames = siti?.si?.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Content characteristics</CardTitle>
        <CardDescription>
          Measured on the source before packaging. Spatial and temporal information follow ITU-T
          P.910; live action typically sits well above these values, which is the premise the
          content-adaptive ladder is built on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MetricTileGrid columns={4}>
          <MetricTile
            value={formatNumber(meanSi)}
            label="Mean spatial information (SI)"
            title="Edge energy per frame. Flat cel-shaded areas keep this low."
          />
          <MetricTile
            value={formatNumber(meanTi)}
            label="Mean temporal information (TI)"
            title="Frame-to-frame difference energy. Held frames drive this toward zero."
          />
          <MetricTile
            value={
              duplicateShare != null ? formatPercent(duplicateShare) : "—"
            }
            label='Duplicate frames ("on twos")'
            title={
              duplicateShare != null
                ? "Share of frames identical to their predecessor — animation drawn on twos repeats every other frame."
                : "Not computed for this analysis run."
            }
          />
          <MetricTile
            value={frames > 0 ? frames.toLocaleString() : "—"}
            label={
              durationSec != null
                ? `Frames analysed · ${durationSec.toFixed(1)} s`
                : "Frames analysed"
            }
          />
        </MetricTileGrid>

        {duplicateShare == null && (
          <p className="mt-4 text-xs text-muted-foreground">
            Duplicate-frame share was not recorded for this analysis run. It is derived from the
            TI series, so re-running the analysis will populate it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
