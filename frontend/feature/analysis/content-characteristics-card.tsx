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

/** TI below which a frame counts as a repeat. Mirrors `SitiAnalyzer.DuplicateTiThreshold`. */
const DUPLICATE_TI_THRESHOLD = 2;

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
 * a footnote — it is what "shot on twos" looks like in the signal. Source CAMBI is the banding the
 * encoder was handed, without which a rendition's CAMBI cannot say how much compression added.
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
  const sourceCambi = series?.sourceCambi;
  const frames = siti?.si?.length ?? 0;

  const extent = [
    frames > 0 ? `${frames.toLocaleString()} frames` : null,
    durationSec != null ? `${durationSec.toFixed(1)} s` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Content characteristics</CardTitle>
        <CardDescription>
          Measured on the source before packaging{extent ? ` (${extent})` : ""}. Spatial and
          temporal information follow ITU-T P.910; live action typically sits well above these
          values, which is the premise the content-adaptive ladder is built on.
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
                ? `Share of frames with TI below ${DUPLICATE_TI_THRESHOLD}. A held drawing still differs from the frame before it by coding noise in a lossy master, so exact repeats are rare; the threshold sits just above that noise.`
                : "Not computed for this analysis run."
            }
          />
          <MetricTile
            value={formatNumber(sourceCambi)}
            label="Source banding (CAMBI)"
            title={
              sourceCambi != null
                ? `Banding already present in the source, 0 = none${series?.sourceCambiMax != null ? `; worst frame ${formatNumber(series.sourceCambiMax)}` : ""}. Each rendition's CAMBI is read against this floor.`
                : "Not measured for this analysis run."
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
