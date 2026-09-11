"use client";

import * as React from "react";
import {
  CartesianGrid,
  ReferenceArea,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  MetricTile,
  MetricTileGrid,
  toneForGain,
  toneForSaving,
} from "@/components/metric-tiles";
import { ExportCsvButton } from "@/components/export-csv-button";
import { slugFilename } from "@/lib/csvExport";
import { formatNumber, formatSigned, ladderLabel } from "@/lib/analysisFormat";
import { useChartSize } from "@/feature/analysis/use-chart-size";
import type {
  LadderComparisonDocument,
  LadderComparisonPoint,
} from "@/lib/videoAnalysisApi";

const chartConfig = {
  static: { label: "Static", color: "var(--foreground)" },
  dynamic: { label: "Dynamic", color: "var(--chart-1)" },
  animation: { label: "Animation-tuned", color: "var(--chart-2)" },
} satisfies ChartConfig;

function colorFor(kind: string): string {
  switch (kind) {
    case "dynamic":
      return "var(--chart-1)";
    case "animation":
      return "var(--chart-2)";
    default:
      return "var(--foreground)";
  }
}

/**
 * Curve points for one ladder, ordered for a joined line.
 *
 * The backend builds these by iterating a dictionary of renditions and does not sort, so drawing
 * them as-is would produce a zigzag rather than a rate–quality curve.
 */
function toCurve(points: LadderComparisonPoint[]) {
  return points
    .slice()
    .sort((a, b) => a.bitrateBps - b.bitrateBps)
    .map((point) => ({
      bitrateKbps: point.bitrateBps / 1000,
      vmaf: point.vmafHarmonicMean,
      label: point.label,
      cambi: point.cambi,
    }));
}

/**
 * Derived ladders against the static baseline.
 *
 * Shows the BD-rate headline alongside the curves it was integrated over, because a single
 * percentage cannot show *where* a ladder wins — and the shaded band makes the quality range the
 * integral actually covers visible rather than a footnote.
 */
export function LadderComparisonCard({
  comparison,
}: {
  comparison?: LadderComparisonDocument;
}) {
  const staticCurve = React.useMemo(
    () => toCurve(comparison?.staticPoints ?? []),
    [comparison],
  );

  const ladderCurves = React.useMemo(
    () =>
      (comparison?.ladders ?? [])
        .filter((entry) => entry.points?.length)
        .map((entry) => ({
          kind: entry.ladderKind,
          label: entry.label,
          data: toCurve(entry.points),
        })),
    [comparison],
  );

  const exportRows = React.useMemo(() => {
    const rows: Array<Array<string | number>> = [];
    for (const point of comparison?.staticPoints ?? []) {
      rows.push([
        "static",
        point.label,
        point.bitrateBps,
        point.vmafHarmonicMean,
        point.vmafMean,
        point.cambi ?? "",
      ]);
    }
    for (const entry of comparison?.ladders ?? []) {
      for (const point of entry.points ?? []) {
        rows.push([
          entry.ladderKind,
          point.label,
          point.bitrateBps,
          point.vmafHarmonicMean,
          point.vmafMean,
          point.cambi ?? "",
        ]);
      }
    }
    return rows;
  }, [comparison]);

  const { ref: chartRef, size: chartSize } = useChartSize<HTMLDivElement>();

  if (!comparison || comparison.ladders.length === 0) {
    return null;
  }

  // The band BD-rate was integrated over. Taken from the first entry that reports one; all
  // entries are integrated against the same static baseline, so the ranges coincide closely.
  const banded = comparison.ladders.find((entry) => !entry.error);
  const hasCurves = staticCurve.length > 0 && ladderCurves.length > 0;

  const allVmaf = [
    ...staticCurve.map((point) => point.vmaf),
    ...ladderCurves.flatMap((curve) => curve.data.map((point) => point.vmaf)),
  ];
  const yMin = allVmaf.length ? Math.max(0, Math.min(...allVmaf) - 5) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">
              Derived ladders vs static (BD-rate)
            </CardTitle>
            <CardDescription>
              Measured on the packaged renditions of each ladder against the static baseline, at
              the bitrates actually achieved rather than the ones requested. Negative BD-rate
              means that ladder delivers the same quality for fewer bits.
            </CardDescription>
          </div>
          {exportRows.length > 0 && (
            <ExportCsvButton
              filename={slugFilename(["ladder-comparison"])}
              headers={[
                "ladder",
                "rung",
                "bitrate_bps",
                "vmaf_harmonic_mean",
                "vmaf_mean",
                "cambi",
              ]}
              rows={exportRows}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {comparison.ladders.map((entry) =>
          entry.error ? (
            <div key={entry.ladderKind}>
              <div className="text-sm font-medium">{entry.label}</div>
              <p className="text-sm text-muted-foreground">{entry.error}</p>
            </div>
          ) : (
            <div key={entry.ladderKind}>
              <div className="mb-2 text-sm font-medium">{entry.label}</div>
              <MetricTileGrid columns={4}>
                <MetricTile
                  value={`${formatSigned(entry.bdRatePercent)}%`}
                  label={`BD-rate over harmonic VMAF ${entry.overlapLowVmaf.toFixed(1)}–${entry.overlapHighVmaf.toFixed(1)}`}
                  tone={toneForSaving(entry.bdRatePercent)}
                />
                <MetricTile
                  value={
                    entry.bdRateHighBandPercent != null
                      ? `${formatSigned(entry.bdRateHighBandPercent)}%`
                      : "—"
                  }
                  label="BD-rate at harmonic VMAF ≥ 60"
                  tone={toneForSaving(entry.bdRateHighBandPercent)}
                  title="The same integral restricted to the quality range viewers are normally served at. Over the full overlap the lowest rungs, which exist for bad networks, weigh as much as the ones people watch."
                />
                <MetricTile
                  value={
                    entry.bitrateSavingPercent != null
                      ? `${formatSigned(entry.bitrateSavingPercent)}%`
                      : "—"
                  }
                  label="Bitrate at equal quality"
                  tone={toneForSaving(entry.bitrateSavingPercent)}
                />
                <MetricTile
                  value={
                    entry.vmafGainAtEqualBitrate != null
                      ? formatSigned(entry.vmafGainAtEqualBitrate)
                      : "—"
                  }
                  label="VMAF at equal bitrate"
                  tone={toneForGain(entry.vmafGainAtEqualBitrate)}
                />
              </MetricTileGrid>
            </div>
          ),
        )}

        {hasCurves && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Rate–quality curves</h4>
            <p className="text-xs text-muted-foreground">
              Each point is one packaged rendition. The shaded band is the quality range BD-rate
              was integrated over — outside it the curves do not overlap, so no comparison is
              defined there.
            </p>
            <div ref={chartRef} className="h-80 w-full min-h-80 min-w-0">
              {chartSize ? (
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto h-full w-full min-h-0 min-w-0"
                >
                  <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="bitrateKbps"
                      name="Bitrate"
                      unit=" kb/s"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                    />
                    <YAxis
                      type="number"
                      dataKey="vmaf"
                      name="Harmonic VMAF"
                      domain={[yMin, 100]}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      width={44}
                    />
                    <ZAxis range={[64, 64]} />
                    {banded && (
                      <ReferenceArea
                        y1={banded.overlapLowVmaf}
                        y2={banded.overlapHighVmaf}
                        fill="var(--muted)"
                        fillOpacity={0.35}
                        stroke="none"
                      />
                    )}
                    <ChartTooltip
                      cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) {
                          return null;
                        }
                        const raw = payload[0]?.payload as {
                          label?: string;
                          bitrateKbps?: number;
                          vmaf?: number;
                          cambi?: number;
                        };
                        return (
                          <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                            <div className="font-medium text-foreground">
                              {raw.label ?? "rung"}
                            </div>
                            <div className="text-muted-foreground">
                              {raw.bitrateKbps?.toFixed(0)} kb/s · VMAF{" "}
                              {formatNumber(raw.vmaf)}
                            </div>
                            {raw.cambi != null && (
                              <div className="text-muted-foreground">
                                CAMBI {formatNumber(raw.cambi)}
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Scatter
                      name="Static"
                      data={staticCurve}
                      fill="var(--foreground)"
                      line={{ stroke: "var(--foreground)", strokeWidth: 1.5 }}
                      lineType="joint"
                      legendType="none"
                    />
                    {ladderCurves.map((curve) => (
                      <Scatter
                        key={curve.kind}
                        name={curve.label}
                        data={curve.data}
                        fill={colorFor(curve.kind)}
                        line={{ stroke: colorFor(curve.kind), strokeWidth: 1.5 }}
                        lineType="joint"
                        legendType="none"
                      />
                    ))}
                  </ScatterChart>
                </ChartContainer>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <LegendSwatch color="var(--foreground)" label="Static" />
              {ladderCurves.map((curve) => (
                <LegendSwatch
                  key={curve.kind}
                  color={colorFor(curve.kind)}
                  label={ladderLabel(curve.kind)}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-4 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
