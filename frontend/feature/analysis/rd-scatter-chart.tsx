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
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";

const HEIGHT_KEYS = [1080, 720, 480, 360, 240] as const;

const chartConfig = {
  h1080: { label: "1080p", color: "var(--chart-1)" },
  h720: { label: "720p", color: "var(--chart-2)" },
  h480: { label: "480p", color: "var(--chart-3)" },
  h360: { label: "360p", color: "var(--chart-4)" },
  h240: { label: "240p", color: "var(--chart-5)" },
  derived: { label: "Derived ladder", color: "var(--primary)" },
} satisfies ChartConfig;

function heightKey(height: number): keyof typeof chartConfig {
  const match = HEIGHT_KEYS.find((h) => h === height);
  return match ? (`h${match}` as keyof typeof chartConfig) : "h480";
}

function formatBitrateKbps(bps: number) {
  return Number((bps / 1000).toFixed(0));
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
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [okPoints]);

  const derivedPoints = React.useMemo(() => {
    if (!derivedLadder?.variants?.length) {
      return [];
    }
    return derivedLadder.variants.map((v) => {
      const parts = v.resolution.split(/[:xX]/);
      const height = parts.length === 2 ? Number(parts[1]) : 0;
      return {
        bitrateKbps: v.bitrateBps / 1000,
        vmaf: v.predictedVmaf ?? 0,
        label: v.label,
        height,
      };
    });
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

  return (
    <Card>
      <CardHeader className="border-b py-5">
        <CardTitle className="text-base">Rate–distortion (encode grid)</CardTitle>
        <CardDescription>
          Measured bitrate vs mean VMAF per resolution×CRF sample. Stars mark
          the derived crossover ladder.
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
                <CartesianGrid vertical={false} />
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
                <ZAxis range={[60, 60]} />
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
                    };
                    return (
                      <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                        <div className="font-medium text-foreground">
                          {raw.label ?? "point"}
                          {raw.crf != null ? ` · CRF ${raw.crf}` : " · derived"}
                        </div>
                        <div className="text-muted-foreground">
                          {raw.bitrateKbps?.toFixed(0)} kb/s · VMAF{" "}
                          {raw.vmaf?.toFixed(2)}
                        </div>
                      </div>
                    );
                  }}
                />
                <ChartLegend content={<ChartLegendContent />} />
                {byHeight.map(([height, points]) => {
                  const key = heightKey(height);
                  return (
                    <Scatter
                      key={height}
                      name={key}
                      data={points.map((p) => ({
                        bitrateKbps: formatBitrateKbps(p.bitrateBps),
                        vmaf: p.vmafMean,
                        label: p.label,
                        crf: p.crf,
                        height: p.height,
                      }))}
                      fill={`var(--color-${key})`}
                      isAnimationActive={false}
                    />
                  );
                })}
                {derivedPoints.length > 0 && (
                  <Scatter
                    name="derived"
                    data={derivedPoints}
                    fill="var(--color-derived)"
                    shape="star"
                    isAnimationActive={false}
                  />
                )}
              </ScatterChart>
            </ChartContainer>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
