"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
  type TooltipContentProps,
} from "recharts";

import { ChartTooltipBox } from "@/components/chart-tooltip-box";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { ladderColor, ladderLabel } from "@/lib/analysisFormat";
import { fixed, signed } from "@/lib/results/format";
import type {
  ContentRow,
  SavingPoint,
  SteadyStatePoint,
  TuningCrfSeries,
} from "@/lib/results/chapter5";

/** The colour of a video, by its position in the (title-ordered) list, the same in every graph. */
export function videoColor(index: number): string {
  return `var(--chart-${(index % 6) + 1})`;
}

const AXIS = { tickLine: false, axisLine: false, tickMargin: 8, fontSize: 12 } as const;

function NamedPointTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as { title?: string; x?: number; y?: number } | undefined;
  if (!active || !point) {
    return null;
  }
  return (
    <ChartTooltipBox title={point.title}>
      {payload?.map((item) => (
        <div key={String(item.dataKey)}>
          {item.name}: {fixed(item.value as number)}
        </div>
      ))}
    </ChartTooltipBox>
  );
}

function CrfTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }
  return (
    <ChartTooltipBox title={`CRF ${label}`}>
      {payload.map((item) => (
        <div key={String(item.dataKey)}>
          {item.name}: {signed(item.value as number, 3)}
        </div>
      ))}
    </ChartTooltipBox>
  );
}

function DeltaTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }
  return (
    <ChartTooltipBox title={label}>
      {payload.map((item) => (
        <div key={String(item.dataKey)}>
          {item.name}: {signed(item.value as number)} VMAF
        </div>
      ))}
    </ChartTooltipBox>
  );
}

/** Graph 1: each video's mean SI and TI, with the region given for live action in ITU-T P.910. */
export function SiTiPlaneChart({ rows }: { rows: ContentRow[] }) {
  const points = rows.flatMap((row, index) =>
    row.siMean != null && row.tiMean != null
      ? [{ title: row.title, si: row.siMean, ti: row.tiMean, index }]
      : [],
  );
  const config: ChartConfig = { si: { label: "SI" }, ti: { label: "TI" } };
  return (
    <ChartContainer config={config} className="aspect-auto h-80 w-full">
      <ScatterChart margin={{ top: 12, right: 16, bottom: 20, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <ReferenceArea
          x1={80}
          x2={120}
          y1={20}
          y2={60}
          fill="var(--muted-foreground)"
          fillOpacity={0.08}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.3}
          strokeDasharray="4 4"
          label={{
            value: "Live action (P.910)",
            position: "insideTopRight",
            fontSize: 11,
            fill: "var(--muted-foreground)",
          }}
        />
        <XAxis
          type="number"
          dataKey="si"
          name="Mean SI"
          domain={[0, 120]}
          {...AXIS}
          label={{ value: "Mean SI", position: "insideBottom", offset: -12, fontSize: 12 }}
        />
        <YAxis type="number" dataKey="ti" name="Mean TI" domain={[0, 60]} width={40} {...AXIS} />
        <ZAxis range={[90, 90]} />
        <ChartTooltip content={NamedPointTooltip} />
        {points.map((point) => (
          <Scatter
            key={point.title}
            name={point.title}
            data={[point]}
            fill={videoColor(point.index)}
            isAnimationActive={false}
          >
            <LabelList dataKey="title" position="right" fontSize={11} fill="var(--foreground)" />
          </Scatter>
        ))}
      </ScatterChart>
    </ChartContainer>
  );
}

/** Graph 2: full-range BD-rate saving of both derived ladders against the video's mean TI. */
export function SavingsChart({ points }: { points: SavingPoint[] }) {
  const series = (["dynamic", "animation"] as const).map((ladder) => ({
    ladder,
    data: points.flatMap((point) => {
      const bdRate = point[ladder];
      return point.tiMean != null && bdRate != null
        ? [{ title: point.title, ti: point.tiMean, saving: -bdRate }]
        : [];
    }),
  }));
  const config: ChartConfig = Object.fromEntries(
    series.map(({ ladder }) => [
      ladder,
      { label: ladderLabel(ladder), color: ladderColor(ladder) },
    ]),
  );
  return (
    <ChartContainer config={config} className="aspect-auto h-80 w-full">
      <ScatterChart margin={{ top: 12, right: 24, bottom: 20, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="ti"
          name="Mean TI"
          {...AXIS}
          label={{ value: "Mean TI", position: "insideBottom", offset: -12, fontSize: 12 }}
        />
        <YAxis
          type="number"
          dataKey="saving"
          name="Bitrate saving (%)"
          unit=" %"
          width={52}
          {...AXIS}
        />
        <ZAxis range={[80, 80]} />
        <ChartTooltip content={NamedPointTooltip} />
        <Legend verticalAlign="top" height={28} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        {series.map(({ ladder, data }) => (
          <Scatter
            key={ladder}
            name={ladderLabel(ladder)}
            data={data}
            fill={ladderColor(ladder)}
            isAnimationActive={false}
          >
            {ladder === "animation" && (
              <LabelList
                dataKey="title"
                position="top"
                fontSize={11}
                fill="var(--muted-foreground)"
              />
            )}
          </Scatter>
        ))}
      </ScatterChart>
    </ChartContainer>
  );
}

/** Graphs 3 and 4: what tuning changes at each CRF, one line per video. */
export function TuningByCrfChart({
  series,
  metric,
}: {
  series: TuningCrfSeries[];
  metric: "vmafDelta" | "cambiDelta";
}) {
  const crfs = [
    ...new Set(series.flatMap((item) => item.points.map((point) => point.crf))),
  ].toSorted((a, b) => a - b);
  const data = crfs.map((crf) => ({
    crf,
    ...Object.fromEntries(
      series.map((item) => [
        item.routeId,
        item.points.find((point) => point.crf === crf)?.[metric] ?? null,
      ]),
    ),
  }));
  const config: ChartConfig = Object.fromEntries(
    series.map((item, index) => [item.routeId, { label: item.title, color: videoColor(index) }]),
  );
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <LineChart data={data} margin={{ top: 12, right: 16, bottom: 20, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="crf"
          {...AXIS}
          label={{ value: "CRF", position: "insideBottom", offset: -12, fontSize: 12 }}
        />
        <YAxis width={44} {...AXIS} tickFormatter={(value: number) => signed(value, 1)} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <ChartTooltip content={CrfTooltip} />
        {series.length > 1 && (
          <Legend
            verticalAlign="top"
            height={28}
            iconType="plainline"
            wrapperStyle={{ fontSize: 12 }}
          />
        )}
        {series.map((item, index) => (
          <Line
            key={item.routeId}
            dataKey={item.routeId}
            name={item.title}
            stroke={videoColor(index)}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

/** Graph 5: animation-optimised minus static, whole session against steady state. */
export function SteadyStateChart({ points }: { points: SteadyStatePoint[] }) {
  const data = points.map((point) => ({
    title: point.title,
    whole: point.whole,
    steady: point.steady,
  }));
  const config: ChartConfig = {
    whole: { label: "Whole session", color: "var(--chart-2)" },
    steady: { label: "Steady state", color: "var(--ladder-animation)" },
  };
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <BarChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="title" {...AXIS} />
        <YAxis width={44} {...AXIS} tickFormatter={(value: number) => signed(value, 0)} />
        <ReferenceLine y={0} stroke="var(--foreground)" strokeOpacity={0.4} />
        <ChartTooltip cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }} content={DeltaTooltip} />
        <Legend verticalAlign="top" height={28} iconType="square" wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="whole"
          name="Whole session"
          fill="var(--color-whole)"
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="steady"
          name="Steady state"
          fill="var(--color-steady)"
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}
