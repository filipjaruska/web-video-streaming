"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { AnalysisTreeNode, SitiSeriesData } from "@/lib/videoAnalysisApi";
import { buildSeriesPoints, downsampleSeries } from "@/lib/analysisDownsample";
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
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  si: {
    label: "SI",
    color: "var(--chart-1)",
  },
  ti: {
    label: "TI",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

function stdDev(values: number[], average: number) {
  if (values.length === 0) {
    return 0;
  }
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

function buildStatsFromSeries(data: SitiSeriesData): AnalysisTreeNode {
  const siAvg =
    data.si.reduce((sum, value) => sum + value, 0) /
    Math.max(data.si.length, 1);
  const tiAvg =
    data.ti.reduce((sum, value) => sum + value, 0) /
    Math.max(data.ti.length, 1);
  const siMin = data.si.length ? Math.min(...data.si) : 0;
  const siMax = data.si.length ? Math.max(...data.si) : 0;
  const tiMin = data.ti.length ? Math.min(...data.ti) : 0;
  const tiMax = data.ti.length ? Math.max(...data.ti) : 0;

  const format = (value: number) =>
    value.toLocaleString("en-US", {
      maximumFractionDigits: 4,
      useGrouping: false,
    });

  return {
    id: "siti",
    label: "SI/TI Analysis",
    meta: { source: "ffmpeg-siti", status: "completed", kind: "section" },
    children: [
      { id: "siti.avg_si", label: "Average SI", value: format(siAvg) },
      { id: "siti.max_si", label: "Max SI", value: format(siMax) },
      { id: "siti.min_si", label: "Min SI", value: format(siMin) },
      {
        id: "siti.std_si",
        label: "Std dev SI",
        value: format(stdDev(data.si, siAvg)),
      },
      { id: "siti.avg_ti", label: "Average TI", value: format(tiAvg) },
      { id: "siti.max_ti", label: "Max TI", value: format(tiMax) },
      { id: "siti.min_ti", label: "Min TI", value: format(tiMin) },
      {
        id: "siti.std_ti",
        label: "Std dev TI",
        value: format(stdDev(data.ti, tiAvg)),
      },
    ],
  };
}

interface SitiChartProps {
  data?: SitiSeriesData | null;
  stats?: AnalysisTreeNode | null;
  title?: string;
  description?: string;
}

function SitiStatsList({ node }: { node: AnalysisTreeNode }) {
  const rows =
    node.children && node.children.length > 0 ? node.children : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>{node.label}</span>
        {node.meta?.status === "failed" && (
          <Badge variant="destructive">Failed</Badge>
        )}
        {node.meta?.status === "running" && (
          <Badge variant="secondary">Running</Badge>
        )}
        {node.meta?.status === "pending" && (
          <Badge variant="outline">Pending</Badge>
        )}
      </div>
      {node.meta?.error && (
        <p className="text-sm text-destructive">{node.meta.error}</p>
      )}
      {rows && (
        <div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 border-b border-border/50 py-1.5 text-sm last:border-b-0"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="break-all font-mono text-xs">{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SitiChart({
  data,
  stats,
  title = "Spatial Information (SI) and Temporal Information (TI) analysis results",
  description = "Spatial and temporal information (ITU-T P.910) for the source video.",
}: SitiChartProps) {
  const hasSeries = !!data && data.si.length > 0;
  const points = React.useMemo(
    () => (hasSeries && data ? buildSeriesPoints(data) : []),
    [data, hasSeries],
  );
  const chartData = React.useMemo(
    () => downsampleSeries(points, 1500),
    [points],
  );
  const statsNode = React.useMemo(() => {
    if (stats) {
      return stats;
    }
    if (hasSeries && data) {
      return buildStatsFromSeries(data);
    }
    return null;
  }, [stats, data, hasSeries]);

  return (
    <Card className="pt-0">
      <CardHeader className="border-b py-5">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-2 pt-4 sm:px-6 sm:pt-6">
        {statsNode && <SitiStatsList node={statsNode} />}

        {hasSeries ? (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">SI/TI over time</h3>
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-[280px] w-full"
            >
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="fillSi" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-si)"
                      stopOpacity={0.8}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-si)"
                      stopOpacity={0.1}
                    />
                  </linearGradient>
                  <linearGradient id="fillTi" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-ti)"
                      stopOpacity={0.8}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-ti)"
                      stopOpacity={0.1}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="timeSec"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => formatSeconds(Number(value))}
                />
                <YAxis tickLine={false} axisLine={false} width={40} />
                <ChartTooltip
                  cursor={false}
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
                  dataKey="si"
                  type="natural"
                  fill="url(#fillSi)"
                  stroke="var(--color-si)"
                  strokeWidth={1.5}
                />
                <Area
                  dataKey="ti"
                  type="natural"
                  fill="url(#fillTi)"
                  stroke="var(--color-ti)"
                  strokeWidth={1.5}
                />
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          </div>
        ) : (
          !statsNode && (
            <p className="text-sm text-muted-foreground">
              No SI/TI data available yet.
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
