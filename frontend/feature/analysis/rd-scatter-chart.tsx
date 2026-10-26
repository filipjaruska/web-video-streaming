"use client";

import * as React from "react";
import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
  type TooltipContentProps,
} from "recharts";
import type { DerivedLadderDocument, EncodeGridPoint } from "@/lib/videoAnalysisApi";
import { ChartTooltipBox } from "@/components/chart-tooltip-box";
import { EmptyState } from "@/components/empty-state";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Figure } from "@/components/figure";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatMbpsTick, logDomain, logTicks } from "@/lib/chartScale";
import { slugFilename } from "@/lib/csvExport";

/**
 * Highest to lowest; legend and series always follow this order. The resolutions of the static
 * ladder (Apple's HLS authoring spec) and, before it, of the ladder clips analysed earlier used.
 */
const HEIGHT_KEYS = [1080, 720, 540, 480, 432, 360, 240, 234] as const;

type HeightKey = `h${(typeof HEIGHT_KEYS)[number]}`;

const chartConfig = {
  h1080: { label: "1080p", color: "var(--chart-1)" },
  h720: { label: "720p", color: "var(--chart-2)" },
  h540: { label: "540p", color: "var(--chart-3)" },
  h480: { label: "480p", color: "var(--chart-3)" },
  h432: { label: "432p", color: "var(--chart-4)" },
  h360: { label: "360p", color: "var(--chart-5)" },
  h240: { label: "240p", color: "var(--chart-6)" },
  h234: { label: "234p", color: "var(--chart-6)" },
} satisfies ChartConfig;

function heightKey(height: number): HeightKey {
  const match = HEIGHT_KEYS.find((h) => h === height);
  return match ? `h${match}` : "h540";
}

function toMbps(bps: number) {
  return bps / 1_000_000;
}

type QualityMetric = "harmonic" | "mean";

/**
 * The ladder is derived from the harmonic mean, so that is what the convex hull is built on.
 * Plotting the arithmetic mean instead would draw hull vertices that appear not to be on a hull.
 */
function qualityOf(point: EncodeGridPoint, metric: QualityMetric) {
  return metric === "harmonic" ? (point.vmafHarmonicMean ?? point.vmafMean) : point.vmafMean;
}

function StarMarker(props: {
  cx?: number;
  cy?: number;
  fill?: string;
  size?: number;
  stroke?: string;
  strokeWidth?: number;
}) {
  const {
    cx = 0,
    cy = 0,
    fill = "currentColor",
    size = 10,
    stroke = "var(--chart-star-stroke)",
    strokeWidth = 1.25,
  } = props;
  const r = size / 2;
  const points: string[] = [];
  for (let i = 0; i < 5; i++) {
    const outer = ((i * 72 - 90) * Math.PI) / 180;
    const inner = ((i * 72 - 90 + 36) * Math.PI) / 180;
    points.push(
      `${cx + r * Math.cos(outer)},${cy + r * Math.sin(outer)}`,
      `${cx + r * 0.45 * Math.cos(inner)},${cy + r * 0.45 * Math.sin(inner)}`,
    );
  }
  return (
    <polygon
      points={points.join(" ")}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  );
}

/** Scatter shape for derived rungs. Recharts hands each symbol its Scatter's own `fill`. */
function DerivedStar({ cx, cy, fill }: { cx?: number; cy?: number; fill?: string }) {
  return (
    <StarMarker
      cx={cx}
      cy={cy}
      fill={fill}
      size={14}
      stroke="var(--chart-star-stroke)"
      strokeWidth={1.6}
    />
  );
}

/** Scatter shape that draws only the connecting line. */
function NoMarker() {
  return <g />;
}

function RdLegend({
  heights,
  showDerived,
  showHull,
}: {
  heights: number[];
  showDerived: boolean;
  showHull: boolean;
}) {
  const ordered = HEIGHT_KEYS.filter((h) => heights.includes(h));

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 pt-3 text-xs">
      {showHull && (
        <div className="flex items-center gap-1.5">
          <svg width="18" height="14" viewBox="0 0 18 14" className="shrink-0" aria-hidden>
            <path
              d="M1 11 L7 5 L17 2"
              fill="none"
              stroke="var(--foreground)"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Convex hull</span>
        </div>
      )}
      {showDerived && (
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0" aria-hidden>
            <StarMarker
              cx={7}
              cy={7}
              size={11}
              fill="var(--chart-star-fill)"
              stroke="var(--chart-star-stroke)"
              strokeWidth={1.6}
            />
          </svg>
          <span>Ladder rung</span>
        </div>
      )}
      {ordered.map((height) => {
        const key = heightKey(height);
        return (
          <div key={key} className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: chartConfig[key].color }}
            />
            <span>{chartConfig[key].label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Module-level so Recharts, which mounts `content` as a component, keeps one stable type.
function PointTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }
  const raw = payload[0]?.payload as {
    mbps?: number;
    vmaf?: number;
    label?: string;
    crf?: number;
    derived?: boolean;
  };
  return (
    <ChartTooltipBox
      title={`${raw.label ?? "point"}${raw.derived ? " · ladder rung" : raw.crf != null ? ` · CRF ${raw.crf}` : ""}`}
    >
      <div>
        {raw.mbps?.toFixed(2)} Mb/s · VMAF {raw.vmaf?.toFixed(2)}
      </div>
    </ChartTooltipBox>
  );
}

interface RdScatterChartProps {
  encodeGrid: EncodeGridPoint[];
  derivedLadder?: DerivedLadderDocument | null;
  /** Bitrates where the hull hands over between resolutions, keyed `"1080p>720p"`. */
  crossoverBps?: Record<string, number> | null;
  title?: string;
  note?: string;
}

export function RdScatterChart({
  encodeGrid,
  derivedLadder,
  crossoverBps,
  title = "Rate–distortion, default grid",
  note,
}: RdScatterChartProps) {
  const [metric, setMetric] = React.useState<QualityMetric>("harmonic");

  const okPoints = React.useMemo(
    () => encodeGrid.filter((p) => !p.error && p.bitrateBps > 0),
    [encodeGrid],
  );

  const hullPoints = React.useMemo(
    () =>
      okPoints
        .filter((p) => p.onHull)
        .toSorted((a, b) => a.bitrateBps - b.bitrateBps)
        .map((p) => ({
          mbps: toMbps(p.bitrateBps),
          vmaf: qualityOf(p, metric),
          label: `${p.label} hull`,
          crf: p.crf,
        })),
    [okPoints, metric],
  );

  const byHeight = React.useMemo(() => {
    const map = new Map<number, EncodeGridPoint[]>();
    for (const point of okPoints) {
      const list = map.get(point.height) ?? [];
      list.push(point);
      map.set(point.height, list);
    }
    // Always highest → lowest so series + colors stay consistent.
    return HEIGHT_KEYS.filter((h) => map.has(h)).map((h) => [h, map.get(h)!] as const);
  }, [okPoints]);

  const derivedByHeight = React.useMemo(() => {
    if (!derivedLadder?.variants?.length) {
      return new Map<
        number,
        Array<{
          mbps: number;
          vmaf: number;
          label: string;
          height: number;
        }>
      >();
    }

    const map = new Map<
      number,
      Array<{
        mbps: number;
        vmaf: number;
        label: string;
        height: number;
      }>
    >();

    for (const v of derivedLadder.variants) {
      const parts = v.resolution.split(/[:xX]/);
      const height = parts.length === 2 ? Number(parts[1]) : 0;
      const point = {
        mbps: toMbps(v.bitrateBps),
        vmaf:
          (metric === "harmonic"
            ? (v.predictedVmafHarmonic ?? v.predictedVmaf)
            : v.predictedVmaf) ?? 0,
        label: v.label,
        height,
      };
      const list = map.get(height) ?? [];
      list.push(point);
      map.set(height, list);
    }
    return map;
  }, [derivedLadder, metric]);

  // Declared before the early return below: this component re-renders on every 5 s analysis poll,
  // and a poll landing mid-pipeline can empty `okPoints`. If this hook sat after the return, the
  // hook count would drop between renders and React would throw "rendered fewer hooks than
  // expected". It depends only on props, so its position here changes nothing else.
  const exportRows = React.useMemo(() => {
    const gridRows = encodeGrid.map((point) => [
      "encode_grid",
      point.label,
      point.width,
      point.height,
      point.crf,
      point.bitrateBps,
      Number(toMbps(point.bitrateBps).toFixed(6)),
      point.error ? "" : Number(point.vmafMean.toFixed(6)),
      point.vmafHarmonicMean != null ? Number(point.vmafHarmonicMean.toFixed(6)) : "",
      point.vmafMin != null ? Number(point.vmafMin.toFixed(6)) : "",
      point.vmafNegMean != null ? Number(point.vmafNegMean.toFixed(6)) : "",
      point.vmafNegHarmonicMean != null ? Number(point.vmafNegHarmonicMean.toFixed(6)) : "",
      point.cambi != null ? Number(point.cambi.toFixed(6)) : "",
      point.onHull ? 1 : 0,
      point.error ?? "",
    ]);

    const derivedRows =
      derivedLadder?.variants.map((variant) => {
        const parts = variant.resolution.split(/[:xX]/);
        const width = parts.length === 2 ? Number(parts[0]) : "";
        const height = parts.length === 2 ? Number(parts[1]) : "";
        return [
          "derived_ladder",
          variant.label,
          width,
          height,
          variant.crf ?? "",
          variant.bitrateBps,
          Number(toMbps(variant.bitrateBps).toFixed(6)),
          variant.predictedVmaf != null ? Number(variant.predictedVmaf.toFixed(6)) : "",
          variant.predictedVmafHarmonic != null
            ? Number(variant.predictedVmafHarmonic.toFixed(6))
            : "",
          variant.predictedVmafMin != null ? Number(variant.predictedVmafMin.toFixed(6)) : "",
          "",
          "",
          "",
          "",
          "",
        ];
      }) ?? [];

    return [...gridRows, ...derivedRows];
  }, [encodeGrid, derivedLadder]);

  if (okPoints.length === 0) {
    return (
      <EmptyState title="No encode grid yet">
        The CRF × resolution sweep runs after the static ladder is packaged.
      </EmptyState>
    );
  }

  const yMin = Math.max(
    0,
    Math.floor((Math.min(...okPoints.map((p) => qualityOf(p, metric))) - 5) / 10) * 10,
  );
  const presentHeights = byHeight.map(([h]) => h);
  const xDomain = logDomain(okPoints.map((p) => toMbps(p.bitrateBps)));
  const showDerived = derivedByHeight.size > 0;

  return (
    <Figure
      title={title}
      note={
        note ??
        "Each dot is one resolution × CRF encode. The line is the convex hull over all resolutions, stars are the ladder's rungs at their predicted quality, dashed lines the crossovers between resolutions."
      }
      actions={
        <>
          <ToggleGroup
            type="single"
            value={metric}
            onValueChange={(value) => value && setMetric(value as QualityMetric)}
            aria-label="VMAF pooling"
          >
            <ToggleGroupItem value="harmonic">Harmonic</ToggleGroupItem>
            <ToggleGroupItem value="mean">Mean</ToggleGroupItem>
          </ToggleGroup>
          <ExportCsvButton
            filename={slugFilename(["rd-encode-grid", derivedLadder?.name ?? ""])}
            headers={[
              "kind",
              "label",
              "width",
              "height",
              "crf",
              "bitrate_bps",
              "bitrate_mbps",
              "vmaf_mean",
              "vmaf_harmonic_mean",
              "vmaf_min",
              "vmaf_neg_mean",
              "vmaf_neg_harmonic_mean",
              "cambi",
              "on_hull",
              "error",
            ]}
            rows={exportRows}
          />
        </>
      }
    >
      <ChartContainer config={chartConfig} className="aspect-auto h-80 w-full">
        <ScatterChart margin={{ top: 16, right: 16, bottom: 20, left: 4 }}>
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
            name="VMAF"
            domain={[yMin, 100]}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={12}
            width={36}
          />
          <ZAxis range={[40, 40]} />
          {Object.entries(crossoverBps ?? {})
            .toSorted(([, a], [, b]) => a - b)
            .map(([key, bps], index) => (
              <ReferenceLine
                key={key}
                x={toMbps(bps)}
                stroke="var(--muted-foreground)"
                strokeOpacity={0.6}
                strokeDasharray="4 4"
                label={{
                  value: key.replace(">", "→"),
                  position: index % 2 === 0 ? "insideTopLeft" : "insideBottomRight",
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                }}
              />
            ))}
          <ChartTooltip cursor={false} content={PointTooltip} />
          {/* Drawn first so the markers sit on top of it. */}
          {hullPoints.length > 1 && (
            <Scatter
              key="hull"
              name="hull"
              legendType="none"
              data={hullPoints}
              line={{ stroke: "var(--foreground)", strokeWidth: 1.5 }}
              lineType="joint"
              shape={NoMarker}
              isAnimationActive={false}
            />
          )}
          {byHeight.map(([height, points]) => {
            const key = heightKey(height);
            return (
              <Scatter
                key={`grid-${height}`}
                name={key}
                legendType="none"
                data={points.map((p) => ({
                  mbps: toMbps(p.bitrateBps),
                  vmaf: qualityOf(p, metric),
                  label: p.label,
                  crf: p.crf,
                  height: p.height,
                  derived: false,
                }))}
                fill={`var(--color-${key})`}
                fillOpacity={0.8}
                isAnimationActive={false}
              />
            );
          })}
          {HEIGHT_KEYS.filter((h) => derivedByHeight.has(h)).map((height) => {
            const key = heightKey(height);
            const points = derivedByHeight.get(height)!;
            return (
              <Scatter
                key={`derived-${height}`}
                name={`${key}-derived`}
                legendType="none"
                data={points.map((p) => ({ ...p, derived: true }))}
                fill={`var(--color-${key})`}
                shape={DerivedStar}
                isAnimationActive={false}
              />
            );
          })}
        </ScatterChart>
      </ChartContainer>
      <RdLegend
        heights={presentHeights}
        showDerived={showDerived}
        showHull={hullPoints.length > 1}
      />
    </Figure>
  );
}
