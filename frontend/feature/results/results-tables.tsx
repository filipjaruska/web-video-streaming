"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataCell, DataRow, DataTable } from "@/components/ui/data-table";
import {
  MetricTile,
  MetricTileGrid,
  toneForSaving,
} from "@/components/metric-tiles";
import { ExportCsvButton } from "@/components/export-csv-button";
import { slugFilename } from "@/lib/csvExport";
import {
  formatNumber,
  formatPercent,
  formatSigned,
  ladderLabel,
} from "@/lib/analysisFormat";
import { NETWORK_PROFILE_LABELS } from "@/lib/benchmark/types";
import { profileOf } from "@/lib/videoBenchmarksApi";
import type { ClipResult, ClipStatus } from "@/lib/resultsApi";

function statusBadge(status: ClipStatus, errors: string[]) {
  switch (status) {
    case "complete":
      return null;
    case "partial":
      return <Badge variant="secondary">Analysis incomplete</Badge>;
    case "missing":
      return <Badge variant="outline">Not analysed</Badge>;
    case "error":
      return (
        <Badge variant="destructive" title={errors.join("; ")}>
          Unavailable
        </Badge>
      );
  }
}

function ClipCell({ clip }: { clip: ClipResult }) {
  return (
    <DataCell mono={false}>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/${clip.routeId}/analysis`}
          className="underline-offset-4 hover:underline"
        >
          {clip.title}
        </Link>
        {statusBadge(clip.status, clip.errors)}
      </div>
    </DataCell>
  );
}

/**
 * The cross-clip view: every measurement the thesis reports per clip, in one place.
 *
 * Each table exports to CSV independently, because these four exports *are* the thesis tables —
 * the point is to download them rather than retype numbers off a screen.
 */
export function ResultsTables({ clips }: { clips: ClipResult[] }) {
  const router = useRouter();

  const dynamicBdRates = clips
    .flatMap((clip) => clip.ladders)
    .filter((ladder) => ladder.kind === "dynamic" && ladder.bdRatePercent != null)
    .map((ladder) => ladder.bdRatePercent as number);

  const animationBdRates = clips
    .flatMap((clip) => clip.ladders)
    .filter(
      (ladder) => ladder.kind === "animation" && ladder.bdRatePercent != null,
    )
    .map((ladder) => ladder.bdRatePercent as number);

  const avg = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;

  const benchmarkRuns = clips.reduce(
    (sum, clip) =>
      sum + clip.benchmarks.reduce((inner, agg) => inner + agg.runs, 0),
    0,
  );

  const analysed = clips.filter(
    (clip) => clip.status === "complete" || clip.status === "partial",
  ).length;

  const contentRows = React.useMemo(
    () =>
      clips.map((clip) => [
        clip.title,
        clip.content?.meanSi ?? "",
        clip.content?.meanTi ?? "",
        clip.content?.duplicateFrameShare ?? "",
        clip.content?.durationSec ?? "",
        clip.content?.frames ?? "",
      ]),
    [clips],
  );

  const ladderRows = React.useMemo(
    () =>
      clips.flatMap((clip) =>
        clip.ladders.map((ladder) => [
          clip.title,
          ladder.kind,
          ladder.bdRatePercent ?? "",
          ladder.overlapLowVmaf ?? "",
          ladder.overlapHighVmaf ?? "",
          ladder.bitrateSavingPercent ?? "",
          ladder.vmafGainAtEqualBitrate ?? "",
          ladder.error ?? "",
        ]),
      ),
    [clips],
  );

  const tuningRows = React.useMemo(
    () =>
      clips.map((clip) => [
        clip.title,
        clip.tuning?.tune ?? "",
        clip.tuning?.pairs ?? "",
        clip.tuning?.meanVmafDelta ?? "",
        clip.tuning?.meanCambiDelta ?? "",
        clip.tuning?.bdRatePercent ?? "",
      ]),
    [clips],
  );

  const playbackRows = React.useMemo(
    () =>
      clips.flatMap((clip) =>
        clip.benchmarks.map((agg) => [
          clip.title,
          agg.networkProfile,
          agg.ladderKind,
          agg.protocol,
          agg.abrAlgorithm,
          agg.runs,
          agg.startupMsMean,
          agg.startupMsStdDev,
          agg.bufferingRatioMean,
          agg.bufferingRatioStdDev,
          agg.qualitySwitchesMean,
          agg.oscillationsMean,
          agg.timeWeightedBitrateBpsMean,
          agg.recoveryMsMean ?? "",
        ]),
      ),
    [clips],
  );

  const hasPlayback = playbackRows.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <MetricTileGrid columns={4} className="flex-1">
          <MetricTile value={`${analysed}/${clips.length}`} label="Clips analysed" />
          <MetricTile
            value={
              avg(dynamicBdRates) != null
                ? `${formatSigned(avg(dynamicBdRates))}%`
                : "—"
            }
            label="Mean BD-rate · dynamic"
            tone={toneForSaving(avg(dynamicBdRates))}
          />
          <MetricTile
            value={
              avg(animationBdRates) != null
                ? `${formatSigned(avg(animationBdRates))}%`
                : "—"
            }
            label="Mean BD-rate · animation"
            tone={toneForSaving(avg(animationBdRates))}
          />
          <MetricTile value={benchmarkRuns} label="Playback runs recorded" />
        </MetricTileGrid>
        <Button variant="outline" size="sm" onClick={() => router.refresh()}>
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Content characteristics</CardTitle>
              <CardDescription>
                Measured on each source before encoding. Low SI and TI are what make a clip
                cheaper to encode than the generic ladder assumes.
              </CardDescription>
            </div>
            <ExportCsvButton
              filename={slugFilename(["results", "content"])}
              headers={[
                "clip",
                "mean_si",
                "mean_ti",
                "duplicate_frame_share",
                "duration_sec",
                "frames",
              ]}
              rows={contentRows}
            />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            headers={["Clip", "Mean SI", "Mean TI", "Duplicate frames", "Duration"]}
          >
            {clips.map((clip) => (
              <DataRow key={clip.routeId}>
                <ClipCell clip={clip} />
                <DataCell>{formatNumber(clip.content?.meanSi)}</DataCell>
                <DataCell>{formatNumber(clip.content?.meanTi)}</DataCell>
                <DataCell>
                  {clip.content?.duplicateFrameShare != null
                    ? formatPercent(clip.content.duplicateFrameShare)
                    : "—"}
                </DataCell>
                <DataCell last>
                  {clip.content?.durationSec != null
                    ? `${clip.content.durationSec.toFixed(1)} s`
                    : "—"}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Ladder efficiency</CardTitle>
              <CardDescription>
                BD-rate of each derived ladder against that clip&apos;s static baseline, measured
                on the packaged renditions. Negative means equal quality for fewer bits.
              </CardDescription>
            </div>
            <ExportCsvButton
              filename={slugFilename(["results", "ladders"])}
              headers={[
                "clip",
                "ladder",
                "bd_rate_percent",
                "overlap_low_vmaf",
                "overlap_high_vmaf",
                "bitrate_saving_percent",
                "vmaf_gain_at_equal_bitrate",
                "error",
              ]}
              rows={ladderRows}
            />
          </div>
        </CardHeader>
        <CardContent>
          {ladderRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No ladder comparison has completed yet. It runs after both derived ladders are
              packaged.
            </p>
          ) : (
            <DataTable
              headers={[
                "Clip",
                "Ladder",
                "BD-rate",
                "Overlap band",
                "Bitrate saving",
                "VMAF gain",
              ]}
            >
              {clips.flatMap((clip) =>
                clip.ladders.map((ladder) => (
                  <DataRow key={`${clip.routeId}-${ladder.kind}`}>
                    <ClipCell clip={clip} />
                    <DataCell mono={false}>{ladderLabel(ladder.kind)}</DataCell>
                    <DataCell
                      title={ladder.error ?? undefined}
                      className={
                        ladder.bdRatePercent != null && ladder.bdRatePercent < 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : undefined
                      }
                    >
                      {ladder.bdRatePercent != null
                        ? `${formatSigned(ladder.bdRatePercent)}%`
                        : "—"}
                    </DataCell>
                    <DataCell>
                      {ladder.overlapLowVmaf != null && ladder.overlapHighVmaf != null
                        ? `${ladder.overlapLowVmaf.toFixed(1)}–${ladder.overlapHighVmaf.toFixed(1)}`
                        : "—"}
                    </DataCell>
                    <DataCell>
                      {ladder.bitrateSavingPercent != null
                        ? `${formatSigned(ladder.bitrateSavingPercent)}%`
                        : "—"}
                    </DataCell>
                    <DataCell last>
                      {formatSigned(ladder.vmafGainAtEqualBitrate)}
                    </DataCell>
                  </DataRow>
                )),
              )}
            </DataTable>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Codec tuning</CardTitle>
              <CardDescription>
                Default x264 against <code className="font-mono text-xs">--tune animation</code>,
                joined on the grid samples the two sweeps share. ΔCAMBI is inverted — negative
                means less banding.
              </CardDescription>
            </div>
            <ExportCsvButton
              filename={slugFilename(["results", "tuning"])}
              headers={[
                "clip",
                "tune",
                "matched_pairs",
                "mean_vmaf_delta",
                "mean_cambi_delta",
                "bd_rate_percent",
              ]}
              rows={tuningRows}
            />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            headers={["Clip", "Tune", "Pairs", "Mean ΔVMAF", "Mean ΔCAMBI", "BD-rate"]}
          >
            {clips.map((clip) => (
              <DataRow key={clip.routeId}>
                <ClipCell clip={clip} />
                <DataCell>{clip.tuning?.tune ?? "—"}</DataCell>
                <DataCell>{clip.tuning?.pairs || "—"}</DataCell>
                <DataCell>{formatSigned(clip.tuning?.meanVmafDelta, 3)}</DataCell>
                <DataCell>{formatSigned(clip.tuning?.meanCambiDelta, 3)}</DataCell>
                <DataCell last title={clip.tuning?.error ?? undefined}>
                  {clip.tuning?.bdRatePercent != null
                    ? `${formatSigned(clip.tuning.bdRatePercent)}%`
                    : "—"}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Playback</CardTitle>
              <CardDescription>
                Session telemetry per measured configuration, as mean ± sample standard deviation
                over repetitions. Network profiles are declared labels — conditions are shaped
                externally, not by the page.
              </CardDescription>
            </div>
            <ExportCsvButton
              filename={slugFilename(["results", "playback"])}
              headers={[
                "clip",
                "network_profile",
                "ladder",
                "protocol",
                "abr_algorithm",
                "runs",
                "startup_ms_mean",
                "startup_ms_stddev",
                "buffering_ratio_mean",
                "buffering_ratio_stddev",
                "quality_switches_mean",
                "oscillations_mean",
                "time_weighted_bitrate_bps_mean",
                "recovery_ms_mean",
              ]}
              rows={playbackRows}
            />
          </div>
        </CardHeader>
        <CardContent>
          {!hasPlayback ? (
            <p className="text-sm text-muted-foreground">
              No playback benchmarks recorded yet. Run a sweep from a clip&apos;s player page.
            </p>
          ) : (
            <DataTable
              headers={[
                "Clip",
                "Network",
                "Ladder",
                "Protocol",
                "ABR",
                "Runs",
                "Startup (ms)",
                "Buffering",
                "Switches",
              ]}
            >
              {clips.flatMap((clip) =>
                clip.benchmarks.map((agg, index) => (
                  <DataRow key={`${clip.routeId}-${index}`}>
                    <ClipCell clip={clip} />
                    <DataCell mono={false}>
                      {NETWORK_PROFILE_LABELS[profileOf(agg)]}
                    </DataCell>
                    <DataCell mono={false}>{ladderLabel(agg.ladderKind)}</DataCell>
                    <DataCell className="uppercase">{agg.protocol}</DataCell>
                    <DataCell>{agg.abrAlgorithm}</DataCell>
                    <DataCell>{agg.runs}</DataCell>
                    <DataCell>
                      {agg.startupMsMean.toFixed(0)} ± {agg.startupMsStdDev.toFixed(0)}
                    </DataCell>
                    <DataCell>
                      {(agg.bufferingRatioMean * 100).toFixed(2)} % ±{" "}
                      {(agg.bufferingRatioStdDev * 100).toFixed(2)}
                    </DataCell>
                    <DataCell last>{agg.qualitySwitchesMean.toFixed(1)}</DataCell>
                  </DataRow>
                )),
              )}
            </DataTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
