import { getApiUrl } from "@/lib/env";
import { listVideos } from "@/lib/videoApi";
import { getVideoAnalysis } from "@/lib/videoAnalysisApi";
import {
  getVideoBenchmarks,
  type BenchmarkAggregateDto,
} from "@/lib/videoBenchmarksApi";
import {
  pickSourceTarget,
  pickStaticTranscode,
} from "@/lib/analysisTargets";

/** Whether a clip has enough measured data to fill a row. */
export type ClipStatus = "complete" | "partial" | "missing" | "error";

export interface ClipContent {
  meanSi: number | null;
  meanTi: number | null;
  duplicateFrameShare: number | null;
  /** Banding already present in the source (CAMBI of the source against itself). */
  sourceCambi: number | null;
  durationSec: number | null;
  frames: number;
}

export interface ClipLadder {
  kind: string;
  label: string;
  bdRatePercent: number | null;
  /** BD-rate integrated only over harmonic VMAF ≥ 60. */
  bdRateHighBandPercent: number | null;
  overlapLowVmaf: number | null;
  overlapHighVmaf: number | null;
  bitrateSavingPercent: number | null;
  vmafGainAtEqualBitrate: number | null;
  error: string | null;
}

export interface ClipTuning {
  tune: string | null;
  pairs: number;
  meanVmafDelta: number | null;
  meanCambiDelta: number | null;
  /** Mean of the per-resolution BD-rates. */
  bdRatePercent: number | null;
  bdRateByResolution: Record<string, number> | null;
  error: string | null;
}

export interface ClipResult {
  routeId: string;
  title: string;
  status: ClipStatus;
  content: ClipContent | null;
  ladders: ClipLadder[];
  tuning: ClipTuning | null;
  benchmarks: BenchmarkAggregateDto[];
  /** Per-source failures, so a partial row can explain itself rather than just showing dashes. */
  errors: string[];
}

function mean(values: number[] | undefined): number | null {
  if (!values || values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Every clip in the catalogue, reduced to the scalars the chapter 5 tables report.
 *
 * Deliberately server-side. The analysis document carries a full per-frame VMAF score array for
 * every rendition of every format — megabytes per clip — and fetching it in the browser would ship
 * all of that just to render a handful of numbers. Reducing it here means only the scalars cross
 * the wire.
 *
 * Failures are contained per source: one clip's analysis 500ing must not blank the page, and one
 * missing benchmark set must not hide a clip's ladder results. Rows are never filtered out — a row
 * that says "not analysed" is honest, a silently shorter table is not.
 */
export async function loadAllResults(): Promise<ClipResult[]> {
  const apiUrl = getApiUrl();
  const { videos } = await listVideos();

  return Promise.all(
    videos.map(async (video): Promise<ClipResult> => {
      const [analysisResult, benchmarksResult] = await Promise.allSettled([
        getVideoAnalysis(apiUrl, video.routeId, {
          next: { revalidate: 60, tags: ["analysis"] },
        }),
        getVideoBenchmarks(apiUrl, video.routeId, {
          next: { revalidate: 60, tags: ["benchmarks"] },
        }),
      ]);

      const title = video.title || video.fileName || video.routeId;
      const errors: string[] = [];

      const benchmarks =
        benchmarksResult.status === "fulfilled"
          ? benchmarksResult.value.aggregates
          : [];

      if (benchmarksResult.status === "rejected") {
        errors.push(`Benchmarks: ${String(benchmarksResult.reason)}`);
      }

      if (analysisResult.status === "rejected") {
        return {
          routeId: video.routeId,
          title,
          status: "error",
          content: null,
          ladders: [],
          tuning: null,
          benchmarks,
          errors: [...errors, `Analysis: ${String(analysisResult.reason)}`],
        };
      }

      const targets = analysisResult.value.targets;
      const source = pickSourceTarget(targets);

      if (!source) {
        return {
          routeId: video.routeId,
          title,
          status: "missing",
          content: null,
          ladders: [],
          tuning: null,
          benchmarks,
          errors,
        };
      }

      const siti = source.series.siti;
      const times = siti?.timeSec;
      const content: ClipContent = {
        meanSi: mean(siti?.si),
        meanTi: mean(siti?.ti),
        duplicateFrameShare: source.series.duplicateFrameShare ?? null,
        sourceCambi: source.series.sourceCambi ?? null,
        durationSec: times?.length ? times[times.length - 1] : null,
        frames: siti?.si?.length ?? 0,
      };

      // Every derived artefact is written onto the static run's report, because all of it is
      // derived from that run — same resolution the per-video view uses, so the two agree.
      const staticTranscode = pickStaticTranscode(targets);
      const comparison = staticTranscode?.series.ladderComparison;
      const tuningDoc = staticTranscode?.series.tuningComparison;

      const ladders: ClipLadder[] = (comparison?.ladders ?? []).map((entry) => ({
        kind: entry.ladderKind,
        label: entry.label,
        bdRatePercent: entry.error ? null : entry.bdRatePercent,
        bdRateHighBandPercent: entry.error ? null : (entry.bdRateHighBandPercent ?? null),
        overlapLowVmaf: entry.error ? null : entry.overlapLowVmaf,
        overlapHighVmaf: entry.error ? null : entry.overlapHighVmaf,
        bitrateSavingPercent: entry.bitrateSavingPercent ?? null,
        vmafGainAtEqualBitrate: entry.vmafGainAtEqualBitrate ?? null,
        error: entry.error ?? null,
      }));

      const tuning: ClipTuning | null = tuningDoc
        ? {
            tune: tuningDoc.tune ?? null,
            pairs: tuningDoc.pairs?.length ?? 0,
            meanVmafDelta: tuningDoc.meanVmafDelta ?? null,
            meanCambiDelta: tuningDoc.meanCambiDelta ?? null,
            bdRatePercent: tuningDoc.bdRatePercent ?? null,
            bdRateByResolution: tuningDoc.bdRateByResolution ?? null,
            error: tuningDoc.error ?? null,
          }
        : null;

      const status: ClipStatus = ladders.length > 0 ? "complete" : "partial";

      return {
        routeId: video.routeId,
        title,
        status,
        content,
        ladders,
        tuning,
        benchmarks,
        errors,
      };
    }),
  );
}
