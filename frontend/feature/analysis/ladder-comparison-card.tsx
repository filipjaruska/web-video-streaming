"use client";

import * as React from "react";
import {
  CartesianGrid,
  Legend,
  ReferenceArea,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
  type TooltipContentProps,
} from "recharts";

import { ChartTooltipBox } from "@/components/chart-tooltip-box";
import { EmptyState } from "@/components/empty-state";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Figure } from "@/components/figure";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import { formatNumber, ladderColor, ladderLabel } from "@/lib/analysisFormat";
import { formatMbpsTick, logDomain, logTicks } from "@/lib/chartScale";
import { slugFilename } from "@/lib/csvExport";
import { signed } from "@/lib/results/format";
import type { LadderComparisonDocument, LadderComparisonPoint } from "@/lib/videoAnalysisApi";

/**
 * Curve points for one ladder, ordered for a joined line. The backend builds them from a
 * dictionary of renditions and does not sort, so as-is they would zigzag.
 */
function toCurve(points: LadderComparisonPoint[]) {
  return points
    .toSorted((a, b) => a.bitrateBps - b.bitrateBps)
    .map((point) => ({
      mbps: point.bitrateBps / 1_000_000,
      vmaf: point.vmafHarmonicMean,
      label: point.label,
      cambi: point.cambi,
    }));
}

function RungTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as ReturnType<typeof toCurve>[number] | undefined;
  if (!active || !point) {
    return null;
  }
  return (
    <ChartTooltipBox title={`${payload?.[0]?.name ?? ""} · ${point.label}`}>
      <div>
        {point.mbps.toFixed(2)} Mb/s · VMAF {formatNumber(point.vmaf)}
      </div>
      {point.cambi != null && <div>CAMBI {formatNumber(point.cambi)}</div>}
    </ChartTooltipBox>
  );
}

/** The derived ladders against the static one: BD figures as in Table 6, then the curves. */
export function LadderComparisonCard({ comparison }: { comparison?: LadderComparisonDocument }) {
  const curves = React.useMemo(
    () => [
      { kind: "static", data: toCurve(comparison?.staticPoints ?? []) },
      ...(comparison?.ladders ?? [])
        .filter((entry) => entry.points?.length)
        .map((entry) => ({ kind: entry.ladderKind, data: toCurve(entry.points) })),
    ],
    [comparison],
  );

  const exportRows = React.useMemo(
    () =>
      [
        { kind: "static", points: comparison?.staticPoints ?? [] },
        ...(comparison?.ladders ?? []).map((entry) => ({
          kind: entry.ladderKind,
          points: entry.points ?? [],
        })),
      ].flatMap(({ kind, points }) =>
        points.map((point) => [
          kind,
          point.label,
          point.bitrateBps,
          point.vmafHarmonicMean,
          point.vmafMean,
          point.cambi ?? "",
        ]),
      ),
    [comparison],
  );

  if (!comparison || comparison.ladders.length === 0) {
    return (
      <EmptyState title="Not compared yet">
        The comparison runs once both derived ladders are packaged and scored.
      </EmptyState>
    );
  }

  // The band BD-rate was integrated over. All entries share the static baseline, so the first one
  // that reports a band stands for all of them.
  const banded = comparison.ladders.find((entry) => !entry.error);
  const vmafs = curves.flatMap((curve) => curve.data.map((point) => point.vmaf));
  const xDomain = logDomain(curves.flatMap((curve) => curve.data.map((point) => point.mbps)));
  const yMin = vmafs.length ? Math.max(0, Math.floor((Math.min(...vmafs) - 5) / 10) * 10) : 0;
  const config: ChartConfig = Object.fromEntries(
    curves.map((curve) => [
      curve.kind,
      { label: ladderLabel(curve.kind), color: ladderColor(curve.kind) },
    ]),
  );

  return (
    <>
      <Figure
        title="Derived ladders against the static ladder"
        note="Measured on the packaged rungs at the bitrates they achieved. Negative BD-rate is a saving at equal quality, positive BD-VMAF more quality at equal bitrate."
      >
        <DataTable
          head={
            <tr className="border-b border-foreground/20">
              <DataHead>Ladder</DataHead>
              <DataHead numeric>BD-rate (%)</DataHead>
              <DataHead numeric>VMAF range</DataHead>
              <DataHead numeric>BD-rate, VMAF ≥ 60</DataHead>
              <DataHead numeric>BD-VMAF</DataHead>
              <DataHead numeric>Bitrate at equal quality (%)</DataHead>
              <DataHead numeric>VMAF at equal bitrate</DataHead>
            </tr>
          }
        >
          {comparison.ladders.map((entry) => (
            <DataRow key={entry.ladderKind}>
              <DataCell mono={false} className="font-medium whitespace-nowrap">
                {ladderLabel(entry.ladderKind)}
              </DataCell>
              {entry.error ? (
                <DataCell colSpan={6} mono={false} className="text-muted-foreground">
                  {entry.error}
                </DataCell>
              ) : (
                <>
                  <DataCell numeric>{signed(entry.bdRatePercent)}</DataCell>
                  <DataCell numeric>
                    {entry.overlapLowVmaf.toFixed(1)}–{entry.overlapHighVmaf.toFixed(1)}
                  </DataCell>
                  <DataCell numeric>{signed(entry.bdRateHighBandPercent)}</DataCell>
                  <DataCell numeric>{signed(entry.bdVmaf)}</DataCell>
                  <DataCell numeric>{signed(entry.bitrateSavingPercent)}</DataCell>
                  <DataCell numeric>{signed(entry.vmafGainAtEqualBitrate)}</DataCell>
                </>
              )}
            </DataRow>
          ))}
        </DataTable>
      </Figure>

      {curves.length > 1 && curves[0].data.length > 0 && (
        <Figure
          title="Rate–quality curves of the packaged ladders"
          note="One point per packaged rung, harmonic VMAF. Shaded: the quality range where the curves overlap and BD-rate is defined."
          actions={
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
          }
        >
          <ChartContainer config={config} className="aspect-auto h-80 w-full">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="mbps"
                name="Bitrate"
                scale="log"
                domain={xDomain}
                ticks={logTicks(xDomain)}
                allowDataOverflow
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                fontSize={12}
                tickFormatter={formatMbpsTick}
                label={{
                  value: "Mb/s, log scale",
                  position: "insideBottom",
                  offset: -12,
                  fontSize: 12,
                }}
              />
              <YAxis
                type="number"
                dataKey="vmaf"
                name="Harmonic VMAF"
                domain={[yMin, 100]}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                fontSize={12}
                width={36}
              />
              <ZAxis range={[48, 48]} />
              {banded && (
                <ReferenceArea
                  y1={banded.overlapLowVmaf}
                  y2={banded.overlapHighVmaf}
                  fill="var(--muted)"
                  fillOpacity={0.5}
                  stroke="none"
                />
              )}
              <ChartTooltip cursor={false} content={RungTooltip} />
              <Legend
                verticalAlign="top"
                height={28}
                iconType="circle"
                wrapperStyle={{ fontSize: 12 }}
              />
              {curves.map((curve) => (
                <Scatter
                  key={curve.kind}
                  name={ladderLabel(curve.kind)}
                  data={curve.data}
                  fill={ladderColor(curve.kind)}
                  line={{ stroke: ladderColor(curve.kind), strokeWidth: 1.5 }}
                  lineType="joint"
                  isAnimationActive={false}
                />
              ))}
            </ScatterChart>
          </ChartContainer>
        </Figure>
      )}
    </>
  );
}
