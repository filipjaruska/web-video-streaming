"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import type { VmafSeriesData, VmafSummary } from "@/lib/videoAnalysisApi";
import {
  buildVmafPoints,
  downsampleVmafSeries,
} from "@/lib/analysisDownsample";
import { formatSeconds } from "@/lib/analysisLabels";
import { Badge } from "@/components/ui/badge";
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
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  vmaf: {
    label: "VMAF",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function formatScore(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 4,
    useGrouping: false,
  });
}

function formatBitrate(bps?: number) {
  if (bps == null || !Number.isFinite(bps)) {
    return "—";
  }
  if (bps >= 1_000_000) {
    return `${(bps / 1_000_000).toFixed(2)} Mb/s`;
  }
  return `${(bps / 1000).toFixed(0)} kb/s`;
}

function SummaryTable({ summary }: { summary: VmafSummary }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Mean", value: formatScore(summary.mean) },
    { label: "Harmonic mean", value: formatScore(summary.harmonicMean) },
    { label: "Min", value: formatScore(summary.min) },
    { label: "Max", value: formatScore(summary.max) },
    { label: "Model", value: summary.model ?? "—" },
    {
      label: "Ladder resolution",
      value:
        summary.width && summary.height
          ? `${summary.width}×${summary.height}`
          : "—",
    },
    { label: "Target bitrate", value: formatBitrate(summary.bitrateBps) },
  ];

  return (
    <div>
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 border-b border-border/50 py-1.5 text-sm last:border-b-0"
        >
          <span className="text-muted-foreground">{row.label}</span>
          <span className="break-all font-mono text-xs">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

interface VmafChartProps {
  data: VmafSeriesData;
  label: string;
  format: "hls" | "dash";
}

export function VmafChart({ data, label, format }: VmafChartProps) {
  const hasSeries = data.scores.length > 0;
  const points = React.useMemo(
    () => (hasSeries ? buildVmafPoints(data) : []),
    [data, hasSeries],
  );
  const chartData = React.useMemo(
    () => downsampleVmafSeries(points, 1500),
    [points],
  );
  const gradientId = React.useId().replace(/:/g, "");

  return (
    <Card>
      <CardHeader className="border-b py-5">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">
            {format.toUpperCase()} · {label}
          </CardTitle>
          <Badge variant="outline">
            mean {formatScore(data.summary.mean)}
          </Badge>
        </div>
        <CardDescription>
          Full-reference VMAF vs source (RD point: bitrate × mean VMAF).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <SummaryTable summary={data.summary} />

        {hasSeries ? (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">VMAF over frames</h3>
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-[240px] w-full"
            >
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient
                    id={`fillVmaf-${gradientId}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="var(--color-vmaf)"
                      stopOpacity={0.8}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-vmaf)"
                      stopOpacity={0.1}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="timeSec"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => formatSeconds(Number(value))}
                />
                <YAxis
                  domain={[0, 100]}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        const first = payload?.[0] as
                          | { payload?: { frame?: number; timeSec?: number } }
                          | undefined;
                        const point = first?.payload;
                        if (!point) {
                          return null;
                        }
                        return `Frame ${point.frame ?? "—"} · ${formatSeconds(point.timeSec ?? 0)}`;
                      }}
                      indicator="dot"
                    />
                  }
                />
                <Area
                  dataKey="vmaf"
                  type="monotone"
                  fill={`url(#fillVmaf-${gradientId})`}
                  stroke="var(--color-vmaf)"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Summary available but no per-frame scores were stored.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
