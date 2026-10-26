"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { VmafSeriesData } from "@/lib/videoAnalysisApi";
import { buildVmafPoints, downsampleVmafSeries } from "@/lib/analysisDownsample";
import { formatSeconds } from "@/lib/analysisLabels";
import { slugFilename } from "@/lib/csvExport";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Figure } from "@/components/figure";
import { formatBitrate } from "@/lib/analysisFormat";
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

interface VmafChartProps {
  data: VmafSeriesData;
  label: string;
  format: "hls" | "dash";
  /** Clip length, to put the frames on a time axis. */
  durationSec?: number | null;
}

export function VmafChart({ data, label, format, durationSec }: VmafChartProps) {
  const hasSeries = data.scores.length > 0;
  const points = React.useMemo(
    () => (hasSeries ? buildVmafPoints(data, durationSec) : []),
    [data, hasSeries, durationSec],
  );
  const timed = points.length > 0 && points[0].timeSec !== null;
  const chartData = React.useMemo(() => downsampleVmafSeries(points, 1500), [points]);
  const gradientId = React.useId().replace(/:/g, "");

  const exportRows = React.useMemo(
    () =>
      points.map((point) => [
        point.frame,
        point.timeSec === null ? "" : Number(point.timeSec.toFixed(6)),
        Number(point.vmaf.toFixed(6)),
      ]),
    [points],
  );

  const summary = data.summary;
  const facts = [
    summary.width && summary.height ? `${summary.width}×${summary.height}` : null,
    summary.bitrateBps ? `measured ${formatBitrate(summary.bitrateBps)}` : null,
    summary.targetBitrateBps ? `target ${formatBitrate(summary.targetBitrateBps)}` : null,
    `max ${formatScore(summary.max)}`,
    summary.cambiMax != null ? `worst-frame CAMBI ${formatScore(summary.cambiMax)}` : null,
    summary.model ?? null,
  ].filter(Boolean);

  return (
    <Figure
      title={`${format.toUpperCase()} ${label}: VMAF per frame`}
      note={`Against the source. ${facts.join(" · ")}.`}
      actions={
        hasSeries && (
          <ExportCsvButton
            filename={slugFilename(["vmaf", format, label])}
            headers={["frame", "time_sec", "vmaf"]}
            rows={exportRows}
          />
        )
      }
    >
      {hasSeries ? (
        <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={`fillVmaf-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-vmaf)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-vmaf)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey={timed ? "timeSec" : "frame"}
              type="number"
              domain={["dataMin", "dataMax"]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              fontSize={12}
              tickFormatter={(value) => (timed ? formatSeconds(Number(value)) : String(value))}
            />
            <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} fontSize={12} />
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
                    return point.timeSec != null
                      ? `Frame ${point.frame ?? "—"} · ${formatSeconds(point.timeSec)}`
                      : `Frame ${point.frame ?? "—"}`;
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
      ) : (
        <p className="text-sm text-muted-foreground">No per-frame scores were stored.</p>
      )}
    </Figure>
  );
}
