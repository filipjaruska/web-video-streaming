import { pickSourceTarget, pickStaticTranscode } from "@/lib/analysisTargets";
import { ladderQualityForTranscode } from "@/lib/benchmark/ladderQuality";
import { steadyStateVmaf } from "@/lib/benchmark/metrics";
import type { NetworkProfile } from "@/lib/benchmark/types";
import { SEGMENT_SEC } from "@/lib/streamingConfig";
import type { StageTiming, VideoAnalysisResponse } from "@/lib/videoAnalysisApi";
import {
  profileOf,
  type BenchmarkAggregateDto,
  type VideoBenchmarkTracesResponse,
  type VideoBenchmarksResponse,
} from "@/lib/videoBenchmarksApi";

/*
 * The cross-clip results, computed the way chapter 5 of the thesis reports them: one function per
 * table or graph, each taking every clip's analysis, benchmark aggregates and run traces. Pure, so
 * it runs on the server and only the reduced rows reach the browser.
 */

export interface ClipData {
  routeId: string;
  title: string;
  analysis: VideoAnalysisResponse | null;
  benchmarks: VideoBenchmarksResponse | null;
  traces: VideoBenchmarkTracesResponse | null;
  /** What failed to load, so a row with dashes can say why. */
  errors?: string[];
}

export type Protocol = "hls" | "dash";
export type Rule = "throughput" | "hybrid" | "buffer";
export type DerivedLadder = "dynamic" | "animation";

export const PROFILES: NetworkProfile[] = ["standard", "fourG", "threeG", "variable"];
/** The steady profiles of Table 10; the variable one has its own table. */
export const STEADY_PROFILES: NetworkProfile[] = ["standard", "fourG", "threeG"];
export const HEIGHTS = [1080, 720, 540, 432, 360, 234] as const;
/** The coarse CRFs both grids encode at every resolution (Graphs 3 and 4). */
export const TUNING_CRFS = [20, 24, 28, 32, 36, 40] as const;

type Num = number | null;

function mean(values: readonly number[]): Num {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Population standard deviation, as SI/TI is reported over every frame of the clip. */
export function populationStdDev(values: readonly number[]): Num {
  const average = mean(values);
  if (average === null) {
    return null;
  }
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function difference(a: Num, b: Num): Num {
  return a === null || b === null ? null : a - b;
}

// —— 5.1.1 Content characteristics ————————————————————————————————————————

export interface ContentRow {
  routeId: string;
  title: string;
  siMean: Num;
  siStdDev: Num;
  tiMean: Num;
  tiStdDev: Num;
  duplicateFrameShare: Num;
  sourceCambi: Num;
}

/** Table 4 and Graph 1. */
export function contentRows(clips: ClipData[]): ContentRow[] {
  return clips.map((clip) => {
    const source = clip.analysis ? pickSourceTarget(clip.analysis.targets) : undefined;
    const siti = source?.series.siti;
    return {
      routeId: clip.routeId,
      title: clip.title,
      siMean: siti ? mean(siti.si) : null,
      siStdDev: siti ? populationStdDev(siti.si) : null,
      tiMean: siti ? mean(siti.ti) : null,
      tiStdDev: siti ? populationStdDev(siti.ti) : null,
      duplicateFrameShare: source?.series.duplicateFrameShare ?? null,
      sourceCambi: source?.series.sourceCambi ?? null,
    };
  });
}

export interface ProgressiveCell {
  startupMs: number;
  bufferingRatio: number;
  runs: number;
}

export interface ProgressiveRow {
  routeId: string;
  title: string;
  byProfile: Record<NetworkProfile, ProgressiveCell | null>;
}

function aggregates(clip: ClipData): BenchmarkAggregateDto[] {
  return clip.benchmarks?.aggregates ?? [];
}

/** Table 5: the source file over progressive download, per network profile. */
export function progressiveRows(clips: ClipData[]): ProgressiveRow[] {
  return clips.map((clip) => {
    const byProfile = Object.fromEntries(
      PROFILES.map((profile) => {
        const sourceCell = aggregates(clip).find(
          (aggregate) => aggregate.protocol === "source" && profileOf(aggregate) === profile,
        );
        return [
          profile,
          sourceCell
            ? {
                startupMs: sourceCell.startupMsMean,
                bufferingRatio: sourceCell.bufferingRatioMean,
                runs: sourceCell.runs,
              }
            : null,
        ];
      }),
    ) as Record<NetworkProfile, ProgressiveCell | null>;
    return { routeId: clip.routeId, title: clip.title, byProfile };
  });
}

// —— 5.1.2 Ladder design and comparison —————————————————————————————————————

export interface LadderFigures {
  bdRate: Num;
  bdRateHighBand: Num;
  bdVmaf: Num;
  error: string | null;
}

export interface LadderRow {
  routeId: string;
  title: string;
  rungs: { static: Num; dynamic: Num; animation: Num };
  ladders: Record<DerivedLadder, LadderFigures | null>;
}

/** Table 6. */
export function ladderRows(clips: ClipData[]): LadderRow[] {
  return clips.map((clip) => {
    const comparison = clip.analysis
      ? pickStaticTranscode(clip.analysis.targets)?.series.ladderComparison
      : undefined;
    const entry = (kind: DerivedLadder) =>
      comparison?.ladders.find((ladder) => ladder.ladderKind === kind);
    const figures = (kind: DerivedLadder): LadderFigures | null => {
      const ladder = entry(kind);
      if (!ladder) {
        return null;
      }
      return ladder.error
        ? { bdRate: null, bdRateHighBand: null, bdVmaf: null, error: ladder.error }
        : {
            bdRate: ladder.bdRatePercent,
            bdRateHighBand: ladder.bdRateHighBandPercent ?? null,
            bdVmaf: ladder.bdVmaf ?? null,
            error: null,
          };
    };
    return {
      routeId: clip.routeId,
      title: clip.title,
      rungs: {
        static: comparison ? comparison.staticPoints.length : null,
        dynamic: entry("dynamic")?.points.length ?? null,
        animation: entry("animation")?.points.length ?? null,
      },
      ladders: { dynamic: figures("dynamic"), animation: figures("animation") },
    };
  });
}

export interface SavingPoint {
  routeId: string;
  title: string;
  tiMean: Num;
  dynamic: Num;
  animation: Num;
}

/** Graph 2: full-range BD-rate of each derived ladder against the clip's mean TI. */
export function savingPoints(clips: ClipData[]): SavingPoint[] {
  const content = contentRows(clips);
  return ladderRows(clips).map((row, index) => ({
    routeId: row.routeId,
    title: row.title,
    tiMean: content[index].tiMean,
    dynamic: row.ladders.dynamic?.bdRate ?? null,
    animation: row.ladders.animation?.bdRate ?? null,
  }));
}

// —— 5.1.3 Codec tuning ———————————————————————————————————————————————————

export interface TuningRow {
  routeId: string;
  title: string;
  pairs: Num;
  vmafDelta: Num;
  cambiDelta: Num;
  bdRateByHeight: Record<number, Num>;
  bdRateMean: Num;
  error: string | null;
}

/** Table 7. */
export function tuningRows(clips: ClipData[]): TuningRow[] {
  return clips.map((clip) => {
    const tuning = clip.analysis
      ? pickStaticTranscode(clip.analysis.targets)?.series.tuningComparison
      : undefined;
    return {
      routeId: clip.routeId,
      title: clip.title,
      pairs: tuning ? tuning.pairs.length : null,
      vmafDelta: tuning?.meanVmafDelta ?? null,
      cambiDelta: tuning?.meanCambiDelta ?? null,
      bdRateByHeight: Object.fromEntries(
        HEIGHTS.map((height) => [height, tuning?.bdRateByResolution?.[`${height}p`] ?? null]),
      ),
      bdRateMean: tuning?.bdRatePercent ?? null,
      error: tuning?.error ?? null,
    };
  });
}

export interface TuningCrfPoint {
  crf: number;
  vmafDelta: number;
  cambiDelta: Num;
}

export interface TuningCrfSeries {
  routeId: string;
  title: string;
  points: TuningCrfPoint[];
}

/**
 * Graphs 3 and 4: ΔVMAF and ΔCAMBI from tuning at each coarse CRF, averaged over the resolutions.
 * A CRF is kept only where both grids encoded every resolution the clip has pairs for, so the
 * average always covers the same set.
 */
export function tuningByCrf(clips: ClipData[]): TuningCrfSeries[] {
  return clips.map((clip) => {
    const pairs = clip.analysis
      ? (pickStaticTranscode(clip.analysis.targets)?.series.tuningComparison?.pairs ?? [])
      : [];
    const heights = new Set(pairs.map((pair) => pair.height));
    const points = TUNING_CRFS.flatMap((crf): TuningCrfPoint[] => {
      const atCrf = pairs.filter((pair) => pair.crf === crf);
      if (atCrf.length === 0 || new Set(atCrf.map((pair) => pair.height)).size < heights.size) {
        return [];
      }
      const cambi = atCrf.flatMap((pair) =>
        pair.baseCambi != null && pair.tunedCambi != null ? [pair.tunedCambi - pair.baseCambi] : [],
      );
      return [
        {
          crf,
          vmafDelta: mean(atCrf.map((pair) => pair.vmafDelta)) as number,
          cambiDelta: cambi.length === atCrf.length ? mean(cambi) : null,
        },
      ];
    });
    return { routeId: clip.routeId, title: clip.title, points };
  });
}

// —— 5.1.4 Computational overhead —————————————————————————————————————————

/** Grid steps record their sample count; encode steps the number of rungs. */
function stageCount(timing: StageTiming | undefined): Num {
  return timing?.count ?? null;
}

export interface OverheadRow {
  routeId: string;
  title: string;
  samplesDefault: Num;
  samplesTuned: Num;
  defaultGrid: Num;
  tunedGrid: Num;
  ladderEncode: Num;
  productionPath: Num;
}

/**
 * Table 8: each phase as a multiple of encoding and packaging the static ladder of the same clip.
 * The production path is both grids, the derivation and encoding plus packaging the
 * animation-optimised ladder; analysing the packaged rungs serves only the measurement.
 */
export function overheadRows(clips: ClipData[]): OverheadRow[] {
  return clips.map((clip) => {
    const timings = clip.analysis
      ? pickSourceTarget(clip.analysis.targets)?.series.stageTimings
      : undefined;
    const ms = (step: string) => timings?.[step]?.durationMs;
    const base = (ms("StaticEncode") ?? 0) + (ms("StaticPackage") ?? 0);
    const multiple = (...steps: string[]): Num => {
      if (!timings || base <= 0 || steps.some((step) => ms(step) === undefined)) {
        return null;
      }
      return steps.reduce((sum, step) => sum + (ms(step) as number), 0) / base;
    };
    return {
      routeId: clip.routeId,
      title: clip.title,
      samplesDefault: stageCount(timings?.EncodeGrid),
      samplesTuned: stageCount(timings?.AnimationGrid),
      defaultGrid: multiple("EncodeGrid"),
      tunedGrid: multiple("AnimationGrid"),
      ladderEncode: multiple("AnimationEncode", "AnimationPackage"),
      productionPath: multiple(
        "EncodeGrid",
        "AnimationGrid",
        "AnimationDeriveLadder",
        "AnimationEncode",
        "AnimationPackage",
      ),
    };
  });
}

// —— 5.1.5 Protocols and ABR ——————————————————————————————————————————————

function cell(
  clip: ClipData,
  profile: NetworkProfile,
  ladder: string,
  protocol: Protocol,
  rule: string,
): BenchmarkAggregateDto | undefined {
  return aggregates(clip).find(
    (aggregate) =>
      profileOf(aggregate) === profile &&
      aggregate.ladderKind === ladder &&
      aggregate.protocol === protocol &&
      aggregate.abrAlgorithm === rule,
  );
}

/** The mean of one value over both protocols, as Tables 10 and 11 average HLS and DASH. */
function bothProtocols(perProtocol: (protocol: Protocol) => Num): Num {
  const hls = perProtocol("hls");
  const dash = perProtocol("dash");
  return hls === null || dash === null ? null : (hls + dash) / 2;
}

/**
 * Steady-state VMAF of one cell: each run's delivered quality after the first segment, from its
 * trace, averaged over the runs that started.
 */
function steadyVmaf(
  clip: ClipData,
  profile: NetworkProfile,
  ladder: string,
  protocol: Protocol,
  rule: string,
): Num {
  if (!clip.analysis || !clip.traces) {
    return null;
  }
  const targets = clip.analysis.targets;
  const values = clip.traces.runs.flatMap((run) => {
    if (
      run.failed ||
      !run.trace ||
      profileOf(run) !== profile ||
      run.ladderKind !== ladder ||
      run.protocol !== protocol ||
      run.abrAlgorithm !== rule
    ) {
      return [];
    }
    const quality = ladderQualityForTranscode(targets, run.transcodeId) ?? undefined;
    const value = steadyStateVmaf(run.trace, quality, SEGMENT_SEC);
    return value === null ? [] : [value];
  });
  return mean(values);
}

export interface ProtocolRow {
  routeId: string;
  title: string;
  ladder: "static" | "animation";
  /** HLS − DASH time-weighted VMAF per profile, for throughput and hybrid. */
  byProfile: Record<NetworkProfile, { throughput: Num; hybrid: Num }>;
}

/** Table 9. */
export function protocolRows(clips: ClipData[]): ProtocolRow[] {
  return clips.flatMap((clip) =>
    (["static", "animation"] as const).map((ladder) => ({
      routeId: clip.routeId,
      title: clip.title,
      ladder,
      byProfile: Object.fromEntries(
        PROFILES.map((profile) => {
          const delta = (rule: Rule) =>
            difference(
              cell(clip, profile, ladder, "hls", rule)?.timeWeightedVmafMean ?? null,
              cell(clip, profile, ladder, "dash", rule)?.timeWeightedVmafMean ?? null,
            );
          return [profile, { throughput: delta("throughput"), hybrid: delta("hybrid") }];
        }),
      ) as Record<NetworkProfile, { throughput: Num; hybrid: Num }>,
    })),
  );
}

export interface LadderPlaybackFigures {
  /** Animation-optimised − static, time-weighted VMAF over the whole session. */
  wholeDelta: Num;
  /** The same after the first segment. */
  steadyDelta: Num;
  /** Relative reduction of time-weighted bitrate, percent; negative means more bits. */
  saving: Num;
}

export interface LadderPlaybackRow {
  profile: NetworkProfile;
  routeId: string;
  title: string;
  byRule: Record<Rule, LadderPlaybackFigures>;
}

/** Table 10: the animation-optimised ladder against the static one, both protocols averaged. */
export function ladderPlaybackRows(clips: ClipData[]): LadderPlaybackRow[] {
  return STEADY_PROFILES.flatMap((profile) =>
    clips.map((clip) => {
      const figures = (rule: Rule): LadderPlaybackFigures => {
        const vmaf = (ladder: string) =>
          bothProtocols(
            (protocol) => cell(clip, profile, ladder, protocol, rule)?.timeWeightedVmafMean ?? null,
          );
        const steady = (ladder: string) =>
          bothProtocols((protocol) => steadyVmaf(clip, profile, ladder, protocol, rule));
        const bitrate = (ladder: string) =>
          bothProtocols(
            (protocol) =>
              cell(clip, profile, ladder, protocol, rule)?.timeWeightedBitrateBpsMean ?? null,
          );
        const staticRate = bitrate("static");
        const animationRate = bitrate("animation");
        return {
          wholeDelta: difference(vmaf("animation"), vmaf("static")),
          steadyDelta: difference(steady("animation"), steady("static")),
          saving:
            staticRate && animationRate !== null ? (1 - animationRate / staticRate) * 100 : null,
        };
      };
      return {
        profile,
        routeId: clip.routeId,
        title: clip.title,
        byRule: {
          throughput: figures("throughput"),
          hybrid: figures("hybrid"),
          buffer: figures("buffer"),
        },
      };
    }),
  );
}

export interface SteadyStatePoint {
  routeId: string;
  title: string;
  whole: Num;
  steady: Num;
}

/** Graph 5: whole session against steady state, throughput rule, 4G. */
export function steadyStatePoints(clips: ClipData[]): SteadyStatePoint[] {
  return ladderPlaybackRows(clips)
    .filter((row) => row.profile === "fourG")
    .map((row) => ({
      routeId: row.routeId,
      title: row.title,
      whole: row.byRule.throughput.wholeDelta,
      steady: row.byRule.throughput.steadyDelta,
    }));
}

// —— 5.1.6 Variable network ———————————————————————————————————————————————

export type PerProtocol = Record<Protocol, Num>;

export interface VariableRow {
  routeId: string;
  title: string;
  ladder: "static" | "dynamic" | "animation";
  throughput: { bufferingPercent: PerProtocol; stallSec: PerProtocol; vmaf: PerProtocol };
  buffer: { vmaf: PerProtocol };
}

/** Table 11: the 4G → 3G → 4G schedule, HLS and DASH side by side. */
export function variableRows(clips: ClipData[]): VariableRow[] {
  return clips.flatMap((clip) =>
    (["static", "dynamic", "animation"] as const).map((ladder) => {
      const per = (rule: Rule, pick: (aggregate: BenchmarkAggregateDto) => Num): PerProtocol => ({
        hls: (() => {
          const aggregate = cell(clip, "variable", ladder, "hls", rule);
          return aggregate ? pick(aggregate) : null;
        })(),
        dash: (() => {
          const aggregate = cell(clip, "variable", ladder, "dash", rule);
          return aggregate ? pick(aggregate) : null;
        })(),
      });
      return {
        routeId: clip.routeId,
        title: clip.title,
        ladder,
        throughput: {
          bufferingPercent: per("throughput", (aggregate) => aggregate.bufferingRatioMean * 100),
          stallSec: per("throughput", (aggregate) => aggregate.rebufferMsMean / 1000),
          vmaf: per("throughput", (aggregate) => aggregate.timeWeightedVmafMean ?? null),
        },
        buffer: { vmaf: per("buffer", (aggregate) => aggregate.timeWeightedVmafMean ?? null) },
      };
    }),
  );
}

// —— The whole chapter ————————————————————————————————————————————————————

export interface RunCounts {
  total: number;
  failed: number;
}

export interface Chapter5Report {
  clips: Array<{ routeId: string; title: string; complete: boolean; errors: string[] }>;
  runs: RunCounts;
  content: ContentRow[];
  progressive: ProgressiveRow[];
  ladders: LadderRow[];
  savings: SavingPoint[];
  tuning: TuningRow[];
  tuningByCrf: TuningCrfSeries[];
  overhead: OverheadRow[];
  protocols: ProtocolRow[];
  ladderPlayback: LadderPlaybackRow[];
  steadyState: SteadyStatePoint[];
  variable: VariableRow[];
}

export function buildChapter5(clips: ClipData[]): Chapter5Report {
  const ordered = clips.toSorted((a, b) => a.title.localeCompare(b.title));
  const runs = ordered.flatMap((clip) => clip.benchmarks?.runs ?? []);
  return {
    clips: ordered.map((clip) => ({
      routeId: clip.routeId,
      title: clip.title,
      complete: !!(
        clip.analysis && pickStaticTranscode(clip.analysis.targets)?.series.ladderComparison
      ),
      errors: clip.errors ?? [],
    })),
    runs: { total: runs.length, failed: runs.filter((run) => run.failed).length },
    content: contentRows(ordered),
    progressive: progressiveRows(ordered),
    ladders: ladderRows(ordered),
    savings: savingPoints(ordered),
    tuning: tuningRows(ordered),
    tuningByCrf: tuningByCrf(ordered),
    overhead: overheadRows(ordered),
    protocols: protocolRows(ordered),
    ladderPlayback: ladderPlaybackRows(ordered),
    steadyState: steadyStatePoints(ordered),
    variable: variableRows(ordered),
  };
}
