"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
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
  type ChartConfig,
} from "@/components/ui/chart";
import { DataCell, DataRow, DataTable } from "@/components/ui/data-table";
import {
  MetricTile,
  MetricTileGrid,
  toneForGain,
  toneForSaving,
} from "@/components/metric-tiles";
import { ExportCsvButton } from "@/components/export-csv-button";
import { slugFilename } from "@/lib/csvExport";
import { formatBitrate, formatNumber, formatSigned } from "@/lib/analysisFormat";
import { useChartSize } from "@/feature/analysis/use-chart-size";
import type { TuningComparisonDocument } from "@/lib/videoAnalysisApi";

const TUNE_ANIMATION_EFFECTS = [
  {
    title: "Deblocking strength",
    detail:
      "Reduced, so flat-colored areas with sharp cel-shaded edges keep their crispness instead of being softened.",
  },
  {
    title: "Psy-RD (psychovisual optimization)",
    detail:
      "Retuned toward detail preservation on flat regions, at the cost of some rate-distortion efficiency measured by simple metrics.",
  },
  {
    title: "Ringing / mosquito noise",
    detail:
      "Targeted for suppression around thin outlines, a common artifact class on line-art-heavy animated content.",
  },
];

const chartConfig = {
  vmafDelta: { label: "ΔVMAF", color: "var(--chart-1)" },
  cambiDelta: { label: "ΔCAMBI", color: "var(--chart-2)" },
} satisfies ChartConfig;

/**
 * Codec tuning impact on animated content: default x264 against `--tune animation`.
 *
 * The comparison joins the two encode grids on the samples they share, so a matched pair differs
 * in nothing but the encoder settings. Packaged renditions could not support this — the two
 * ladders choose different bitrates by construction, so holding the rung constant while varying
 * the tune is impossible there.
 */
export function TuningComparisonCard({
  tuning,
}: {
  tuning?: TuningComparisonDocument;
}) {
  const pairs = tuning?.pairs ?? [];

  const chartData = React.useMemo(
    () =>
      pairs.map((pair) => ({
        name: `${pair.label} CRF${pair.crf}`,
        vmafDelta: pair.vmafDelta,
        cambiDelta:
          pair.baseCambi != null && pair.tunedCambi != null
            ? pair.tunedCambi - pair.baseCambi
            : null,
      })),
    [pairs],
  );

  const exportRows = React.useMemo(
    () =>
      pairs.map((pair) => [
        pair.label,
        pair.height,
        pair.crf,
        pair.baseVmaf,
        pair.tunedVmaf,
        pair.vmafDelta,
        pair.baseCambi ?? "",
        pair.tunedCambi ?? "",
        pair.baseCambi != null && pair.tunedCambi != null
          ? pair.tunedCambi - pair.baseCambi
          : "",
        pair.baseBitrateBps,
        pair.tunedBitrateBps,
      ]),
    [pairs],
  );

  const { ref: chartRef, size: chartSize } = useChartSize<HTMLDivElement>();

  if (!tuning || tuning.error || pairs.length === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Codec tuning for animated content
            </CardTitle>
            <CardDescription>
              Isolates the effect of x264 codec tuning by holding the source, resolution and CRF
              constant and varying only the encoder settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {tuning?.error ??
                "The animation-tuned encode grid has not run for this video yet."}
            </p>
          </CardContent>
        </Card>
        <TuneEffectsCard />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">
                Codec tuning for animated content
              </CardTitle>
              <CardDescription>
                Isolates the effect of x264 codec tuning by holding the source, resolution and CRF
                constant and varying only the encoder settings.
              </CardDescription>
            </div>
            <Badge variant="outline">{pairs.length} matched samples</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <MetricTileGrid>
            <MetricTile
              value={formatSigned(tuning.meanVmafDelta, 3)}
              label="Mean ΔVMAF (tuned − default)"
              tone={toneForGain(tuning.meanVmafDelta)}
            />
            <MetricTile
              value={formatSigned(tuning.meanCambiDelta, 3)}
              label="Mean ΔCAMBI (lower is better)"
              tone={toneForSaving(tuning.meanCambiDelta)}
              title="CAMBI measures banding on flat gradients — the artifact class VMAF scarcely registers and animation is most prone to."
            />
            <MetricTile
              value={
                tuning.bdRatePercent != null
                  ? `${formatSigned(tuning.bdRatePercent)}%`
                  : "—"
              }
              label="BD-rate vs default settings"
              tone={toneForSaving(tuning.bdRatePercent)}
            />
          </MetricTileGrid>
          <p className="text-sm text-muted-foreground">
            Measured with{" "}
            <code className="font-mono text-xs">-tune {tuning.tune}</code>
            {tuning.decimate ? " + mpdecimate" : ""}. BD-rate is computed over the whole curve
            rather than per sample, because a ΔVMAF at fixed CRF says nothing about the bitrate it
            was bought at — the same CRF lands on a different bitrate once the tune changes.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">ΔVMAF per matched sample</CardTitle>
              <CardDescription>
                Tuned minus default at identical resolution and CRF. Bars above zero are a gain
                from tuning; bars below are a regression, which is a known risk — psy-RD can
                improve perceived sharpness at the cost of the objective score.
              </CardDescription>
            </div>
            <ExportCsvButton
              filename={slugFilename(["tuning", tuning.tune ?? "animation"])}
              headers={[
                "rung",
                "height",
                "crf",
                "base_vmaf",
                "tuned_vmaf",
                "vmaf_delta",
                "base_cambi",
                "tuned_cambi",
                "cambi_delta",
                "base_bitrate_bps",
                "tuned_bitrate_bps",
              ]}
              rows={exportRows}
            />
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div ref={chartRef} className="h-72 w-full min-h-72 min-w-0">
            {chartSize ? (
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-full w-full min-h-0 min-w-0"
              >
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 12, bottom: 48, left: 8 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    angle={-45}
                    textAnchor="end"
                    interval={0}
                    height={56}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    width={48}
                  />
                  {/* Without a zero line a signed bar chart cannot be read at all. */}
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <ChartTooltip
                    cursor={{ fill: "var(--muted)", fillOpacity: 0.3 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) {
                        return null;
                      }
                      const raw = payload[0]?.payload as {
                        vmafDelta?: number;
                        cambiDelta?: number | null;
                      };
                      return (
                        <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                          <div className="font-medium text-foreground">{label}</div>
                          <div className="text-muted-foreground">
                            ΔVMAF {formatSigned(raw.vmafDelta, 3)}
                          </div>
                          <div className="text-muted-foreground">
                            ΔCAMBI {formatSigned(raw.cambiDelta, 3)}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="vmafDelta" radius={2}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={index}
                        fill={
                          entry.vmafDelta >= 0
                            ? "var(--chart-2)"
                            : "var(--chart-4)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Matched samples (resolution × CRF)
          </CardTitle>
          <CardDescription>
            Every grid sample present in both the default and the tuned sweep, so the only
            difference is the encoder configuration. ΔCAMBI is inverted relative to ΔVMAF: a
            negative value means less banding, which is an improvement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            headers={[
              "Rung",
              "CRF",
              "Default VMAF",
              "Tuned VMAF",
              "ΔVMAF",
              "ΔCAMBI",
              "Default rate",
              "Tuned rate",
            ]}
          >
            {pairs.map((pair) => (
              <DataRow key={`${pair.label}-${pair.crf}`}>
                <DataCell>{pair.label}</DataCell>
                <DataCell>{pair.crf}</DataCell>
                <DataCell>{formatNumber(pair.baseVmaf)}</DataCell>
                <DataCell>{formatNumber(pair.tunedVmaf)}</DataCell>
                <DataCell>{formatSigned(pair.vmafDelta)}</DataCell>
                <DataCell>
                  {pair.baseCambi != null && pair.tunedCambi != null
                    ? formatSigned(pair.tunedCambi - pair.baseCambi)
                    : "—"}
                </DataCell>
                <DataCell>{formatBitrate(pair.baseBitrateBps)}</DataCell>
                <DataCell last>{formatBitrate(pair.tunedBitrateBps)}</DataCell>
              </DataRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>

      <TuneEffectsCard />
    </div>
  );
}

function TuneEffectsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          What <code className="font-mono text-sm">--tune animation</code> changes
        </CardTitle>
        <CardDescription>
          Per x264 documentation, the effects most relevant to animated content.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {TUNE_ANIMATION_EFFECTS.map((effect) => (
            <div
              key={effect.title}
              className="border-b border-border/50 pb-3 last:border-b-0 last:pb-0"
            >
              <p className="text-sm font-medium">{effect.title}</p>
              <p className="text-sm text-muted-foreground">{effect.detail}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
