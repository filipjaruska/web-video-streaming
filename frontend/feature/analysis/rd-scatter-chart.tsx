"use client";

import * as React from "react";
import {
  CartesianGrid,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type {
  DerivedLadderDocument,
  EncodeGridPoint,
} from "@/lib/videoAnalysisApi";
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

/** Highest → lowest — legend and series always follow this order. */
const HEIGHT_KEYS = [1080, 720, 480, 360, 240] as const;

type HeightKey = `h${(typeof HEIGHT_KEYS)[number]}`;

const chartConfig = {
  h1080: { label: "1080p", color: "var(--chart-1)" },
  h720: { label: "720p", color: "var(--chart-2)" },
  h480: { label: "480p", color: "var(--chart-3)" },
  h360: { label: "360p", color: "var(--chart-4)" },
  h240: { label: "240p", color: "var(--chart-5)" },
} satisfies ChartConfig;

function heightKey(height: number): HeightKey {
  const match = HEIGHT_KEYS.find((h) => h === height);
  return match ? (`h${match}` as HeightKey) : "h480";
}

function formatBitrateKbps(bps: number) {
  return Number((bps / 1000).toFixed(0));
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
    const inner = (((i * 72 - 90) + 36) * Math.PI) / 180;
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

function RdLegend({
  heights,
  showDerived,
}: {
  heights: number[];
  showDerived: boolean;
}) {
  const ordered = HEIGHT_KEYS.filter((h) => heights.includes(h));

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 pt-3 text-xs">
      {showDerived && (
        <div className="flex items-center gap-1.5">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            className="shrink-0"
            aria-hidden
          >
            <StarMarker
              cx={7}
              cy={7}
              size={11}
              fill="var(--chart-star-fill)"
              stroke="var(--chart-star-stroke)"
              strokeWidth={1.6}
            />
          </svg>
          <span>Derived ladder</span>
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

interface RdScatterChartProps {
  encodeGrid: EncodeGridPoint[];
  derivedLadder?: DerivedLadderDocument | null;
}

export function RdScatterChart({
  encodeGrid,
  derivedLadder,
}: RdScatterChartProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = React.useState<{
    width: number;
    height: number;
  } | null>(null);

  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setChartSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const okPoints = React.useMemo(
    () => encodeGrid.filter((p) => !p.error && p.bitrateBps > 0),
    [encodeGrid],
  );

  const byHeight = React.useMemo(() => {
    const map = new Map<number, EncodeGridPoint[]>();
    for (const point of okPoints) {
      const list = map.get(point.height) ?? [];
      list.push(point);
      map.set(point.height, list);
    }
    // Always highest → lowest so series + colors stay consistent.
    return HEIGHT_KEYS.filter((h) => map.has(h)).map(
      (h) => [h, map.get(h)!] as const,
    );
  }, [okPoints]);

  const derivedByHeight = React.useMemo(() => {
    if (!derivedLadder?.variants?.length) {
      return new Map<number, Array<{
        bitrateKbps: number;
        vmaf: number;
        label: string;
        height: number;
      }>>();
    }

    const map = new Map<
      number,
      Array<{
        bitrateKbps: number;
        vmaf: number;
        label: string;
        height: number;
      }>
    >();

    for (const v of derivedLadder.variants) {
      const parts = v.resolution.split(/[:xX]/);
      const height = parts.length === 2 ? Number(parts[1]) : 0;
      const point = {
        bitrateKbps: v.bitrateBps / 1000,
        vmaf: v.predictedVmaf ?? 0,
        label: v.label,
        height,
      };
      const list = map.get(height) ?? [];
      list.push(point);
      map.set(height, list);
    }
    return map;
  }, [derivedLadder]);

  if (okPoints.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Encode-grid RD points will appear here after the CRF × resolution sweep.
      </p>
    );
  }

  const yMin = Math.max(
    0,
    Math.min(...okPoints.map((p) => p.vmafMean)) - 5,
  );
  const presentHeights = byHeight.map(([h]) => h);
  const showDerived = derivedByHeight.size > 0;

  return (
    <Card>
      <CardHeader className="border-b py-5">
        <CardTitle className="text-base">Rate–distortion (encode grid)</CardTitle>
        <CardDescription>
          Measured bitrate vs mean VMAF per resolution×CRF sample. Stars mark
          the derived crossover ladder (same colors as their resolution).
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div ref={containerRef} className="h-80 w-full min-h-80 min-w-0">
          {chartSize ? (
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-full w-full min-h-0 min-w-0"
            >
              <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                <CartesianGrid vertical strokeDasharray="3 3" />
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
                  name="VMAF"
                  domain={[yMin, 100]}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                />
                <ZAxis range={[72, 72]} />
                <ChartTooltip
                  cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) {
                      return null;
                    }
                    const raw = payload[0]?.payload as {
                      bitrateKbps?: number;
                      vmaf?: number;
                      label?: string;
                      crf?: number;
                      derived?: boolean;
                    };
                    return (
                      <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                        <div className="font-medium text-foreground">
                          {raw.label ?? "point"}
                          {raw.derived
                            ? " · derived"
                            : raw.crf != null
                              ? ` · CRF ${raw.crf}`
                              : ""}
                        </div>
                        <div className="text-muted-foreground">
                          {raw.bitrateKbps?.toFixed(0)} kb/s · VMAF{" "}
                          {raw.vmaf?.toFixed(2)}
                        </div>
                      </div>
                    );
                  }}
                />
                {byHeight.map(([height, points]) => {
                  const key = heightKey(height);
                  return (
                    <Scatter
                      key={`grid-${height}`}
                      name={key}
                      legendType="none"
                      data={points.map((p) => ({
                        bitrateKbps: formatBitrateKbps(p.bitrateBps),
                        vmaf: p.vmafMean,
                        label: p.label,
                        crf: p.crf,
                        height: p.height,
                        derived: false,
                      }))}
                      fill={`var(--color-${key})`}
                      isAnimationActive={false}
                    />
                  );
                })}
                {HEIGHT_KEYS.filter((h) => derivedByHeight.has(h)).map(
                  (height) => {
                    const key = heightKey(height);
                    const points = derivedByHeight.get(height)!;
                    return (
                      <Scatter
                        key={`derived-${height}`}
                        name={`${key}-derived`}
                        legendType="none"
                        data={points.map((p) => ({ ...p, derived: true }))}
                        fill={`var(--color-${key})`}
                        shape={(props) => (
                          <StarMarker
                            cx={props.cx}
                            cy={props.cy}
                            fill={`var(--color-${key})`}
                            size={14}
                            stroke="var(--chart-star-stroke)"
                            strokeWidth={1.6}
                          />
                        )}
                        isAnimationActive={false}
                      />
                    );
                  },
                )}
              </ScatterChart>
            </ChartContainer>
          ) : null}
        </div>
        <RdLegend heights={presentHeights} showDerived={showDerived} />
      </CardContent>
    </Card>
  );
}
