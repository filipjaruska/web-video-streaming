import { z } from "zod";

import type {
  AnalysisSeriesDocument,
  AnalysisTarget,
  AnalysisTreeNode,
  DerivedLadderDocument,
  DerivedLadderVariant,
  EncodeGridPoint,
  LadderComparisonDocument,
  PackagingIntegrityDocument,
  SitiSeriesData,
  TuningComparisonDocument,
  VideoAnalysisResponse,
  VmafSeriesData,
  VmafSummary,
} from "@/lib/videoAnalysisApi";
import type {
  ListVideosResponse,
  UpdateVideoResponse,
  UploadSessionResponse,
  VideoListItem,
} from "@/lib/videoApi";
import type {
  BenchmarkAggregateDto,
  BenchmarkRunDto,
  VideoBenchmarksResponse,
} from "@/lib/videoBenchmarksApi";
import type { VideoSubtitlesResponse } from "@/lib/videoSubtitlesApi";
import type { VideoTranscodeListItem, VideoTranscodesResponse } from "@/lib/videoTranscodesApi";

/*
 * Runtime mirrors of the response types the frontend declares in lib/*Api.ts.
 *
 * Each schema `satisfies z.ZodType<T>` against the frontend's own type, so a required field the type
 * gains and the schema lacks fails `tsc`; a response the frontend cannot consume fails at runtime.
 * They are deliberately not strict: an extra field breaks nothing in the UI, and the golden snapshots
 * are what catch additions and removals.
 */

/** The backend writes an absent optional field as null; the frontend types (and its ?. / ?? reads) treat it as absent. */
const absent = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "not an ISO date");
const finite = z.number().refine(Number.isFinite, "not a finite number");
const ladderKind = z.enum(["static", "dynamic", "animation"]);

export const videoListItem = z.object({
  routeId: z.string().min(1),
  title: z.string().nullable(),
  description: z.string().nullable(),
  status: z.enum(["processing", "ready", "failed"]),
  fileName: z.string(),
  thumbnailUrl: z.string().nullable(),
  size: z.number().int().nonnegative(),
  createdAt: isoDate,
  publishedAt: isoDate.nullable(),
  hasHls: z.boolean(),
  hasDash: z.boolean(),
}) satisfies z.ZodType<VideoListItem>;

export const listVideosResponse = z.object({
  count: z.number().int().nonnegative(),
  videos: z.array(videoListItem),
}) satisfies z.ZodType<ListVideosResponse>;

export const uploadSessionResponse = z.object({
  sessionId: z.string().uuid(),
  redirectUrl: z.string(),
  session: z.object({
    status: z.string(),
    progressPercent: z.number(),
    currentStep: z.string().nullish(),
    createdAtUtc: isoDate,
    updatedAtUtc: isoDate,
    expiresAtUtc: isoDate,
    uploadedAtUtc: isoDate.nullable(),
    completedAtUtc: isoDate.nullable(),
    processingStartedAtUtc: isoDate.nullish(),
    estimatedRemainingSeconds: z.number().nullish(),
    currentStepKey: z.string().nullish(),
    currentStepDone: z.number().int().nullish(),
    currentStepTotal: z.number().int().nullish(),
    queuePosition: z.number().int().nullish(),
  }),
  video: z.object({
    routeId: z.string().min(1),
    title: z.string().nullable(),
    description: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
    originalFileName: z.string().nullable(),
    storageKey: z.string().nullable(),
    createdAtUtc: isoDate,
    updatedAtUtc: isoDate,
    publishedAtUtc: isoDate.nullable(),
  }),
}) satisfies z.ZodType<UploadSessionResponse>;

export const updateVideoResponse = z.object({
  routeId: z.string(),
  title: z.string().nullish(),
  description: z.string().nullish(),
}) satisfies z.ZodType<UpdateVideoResponse>;

export const transcodeListItem = z.object({
  id: z.string().min(1),
  ladderKind,
  label: z.string(),
  hasHls: z.boolean(),
  hasDash: z.boolean(),
  isActive: z.boolean(),
  status: z.string(),
  createdAtUtc: isoDate,
  startedAtUtc: isoDate.nullish(),
  completedAtUtc: isoDate.nullish(),
}) satisfies z.ZodType<VideoTranscodeListItem>;

export const transcodesResponse = z.object({
  activeTranscodeId: z.string().nullable(),
  transcodes: z.array(transcodeListItem),
}) satisfies z.ZodType<VideoTranscodesResponse>;

export const benchmarkRun = z.object({
  id: z.string(),
  transcodeId: z.string().nullish(),
  mode: z.string(),
  networkProfile: z.string(),
  ladderKind: z.string(),
  protocol: z.string(),
  abrAlgorithm: z.string(),
  repetition: z.number().int(),
  startupMs: z.number().nullish(),
  bufferingRatio: finite,
  rebufferCount: z.number().int(),
  rebufferMs: finite,
  qualitySwitches: z.number().int(),
  oscillations: z.number().int(),
  timeWeightedBitrateBps: finite,
  droppedFrameRatio: finite,
  recoveryMs: z.number().nullish(),
  failed: z.boolean(),
  errorMessage: z.string().nullish(),
  createdAtUtc: isoDate,
}) satisfies z.ZodType<BenchmarkRunDto>;

export const benchmarkAggregate = z.object({
  networkProfile: z.string(),
  ladderKind: z.string(),
  protocol: z.string(),
  abrAlgorithm: z.string(),
  runs: z.number().int().positive(),
  startupMsMean: finite,
  startupMsStdDev: finite,
  bufferingRatioMean: finite,
  bufferingRatioStdDev: finite,
  qualitySwitchesMean: finite,
  oscillationsMean: finite,
  timeWeightedBitrateBpsMean: finite,
  rebufferMsMean: finite,
  rebufferCountMean: finite,
  recoveryMsMean: z.number().nullish(),
  timeWeightedVmafMean: z.number().nullish(),
  timeWeightedVmafStdDev: z.number().nullish(),
  topRungShareMean: z.number().nullish(),
  resolutionShareMean: z.record(z.string(), z.number()).nullish(),
  droppedFrameRatioMean: z.number().nullish(),
  avgBufferSecMean: z.number().nullish(),
  avgThroughputBpsMean: z.number().nullish(),
  sessionMsMean: z.number().nullish(),
  sessionMsStdDev: z.number().nullish(),
}) satisfies z.ZodType<BenchmarkAggregateDto>;

export const benchmarksResponse = z.object({
  routeId: z.string(),
  schemaVersion: z.number().int(),
  runs: z.array(benchmarkRun),
  aggregates: z.array(benchmarkAggregate),
}) satisfies z.ZodType<VideoBenchmarksResponse>;

const traceSample = z.object({
  atMs: finite,
  playbackSec: finite,
  bufferSec: finite,
  bandwidthBps: finite,
  bitrateBps: finite,
  rungIndex: z.number().int(),
  height: z.number().int().nullish().transform(absent),
  droppedFrames: finite,
  totalFrames: finite,
});

const traceEvent = z.object({ kind: z.string(), atMs: finite }).loose();

export const benchmarkTrace = z.object({
  id: z.string(),
  transcodeId: z.string().nullish(),
  networkProfile: z.string(),
  ladderKind: z.string(),
  protocol: z.string(),
  abrAlgorithm: z.string(),
  repetition: z.number().int(),
  failed: z.boolean(),
  trace: z
    .object({
      samples: z.array(traceSample),
      events: z.array(traceEvent),
      durationMs: finite,
      summary: z.record(z.string(), z.unknown()).nullish().transform(absent),
    })
    .nullable(),
});

/*
 * Not bound with `satisfies`: the trace's events are a tagged union (BenchmarkEvent) that the
 * schema checks only loosely, by kind and time, which the frontend type cannot accept as-is.
 */
export const benchmarkTracesResponse = z.object({
  routeId: z.string(),
  schemaVersion: z.number().int(),
  runs: z.array(benchmarkTrace),
});

export const subtitlesResponse = z.object({
  routeId: z.string(),
  tracks: z.array(
    z.object({
      id: z.string(),
      language: z.string(),
      label: z.string(),
      url: z.string().min(1),
      skipped: z.boolean().nullish().transform(absent),
      skipReason: z.string().nullish(),
    }),
  ),
  skipped: z.array(
    z.object({ id: z.string(), language: z.string(), label: z.string(), reason: z.string() }),
  ),
}) satisfies z.ZodType<VideoSubtitlesResponse>;

// —— Analysis ————————————————————————————————————————————————————————————————

const sectionStatus = z.enum(["pending", "running", "completed", "failed"]);

export const treeNode: z.ZodType<AnalysisTreeNode> = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string().nullish(),
  meta: z
    .object({
      source: z.string().nullish().transform(absent),
      status: sectionStatus.nullish().transform(absent),
      error: z.string().nullish().transform(absent),
      kind: z.enum(["section", "series"]).nullish().transform(absent),
    })
    .nullish()
    .transform(absent),
  get children() {
    return z.array(treeNode).nullish().transform(absent);
  },
});

const sitiSeries = z.object({
  si: z.array(finite),
  ti: z.array(finite),
  timeSec: z.array(finite).nullish().transform(absent),
}) satisfies z.ZodType<SitiSeriesData>;

const vmafSummary = z.object({
  mean: finite,
  harmonicMean: finite,
  min: finite,
  max: finite,
  model: z.string().nullish().transform(absent),
  width: z.number().int().nullish().transform(absent),
  height: z.number().int().nullish().transform(absent),
  bitrateBps: finite.nullish().transform(absent),
  targetBitrateBps: finite.nullish().transform(absent),
  cambi: finite.nullish().transform(absent),
  cambiMax: finite.nullish().transform(absent),
}) satisfies z.ZodType<VmafSummary>;

const vmafSeries = z.object({
  scores: z.array(finite),
  timeSec: z.array(finite).nullish().transform(absent),
  summary: vmafSummary,
  summaryByModel: z.record(z.string(), vmafSummary).nullish().transform(absent),
}) satisfies z.ZodType<VmafSeriesData>;

const byFormat = <T extends z.ZodType>(series: T) =>
  z.object({
    hls: z.record(z.string(), series).nullish().transform(absent),
    dash: z.record(z.string(), series).nullish().transform(absent),
  });

const setting = z.enum(["default", "tuned"]);

const encodeGridPoint = z.object({
  label: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  crf: z.number(),
  bitrateBps: finite,
  vmafMean: finite,
  vmafHarmonicMean: finite.nullish().transform(absent),
  vmafMin: finite.nullish().transform(absent),
  vmafNegMean: finite.nullish().transform(absent),
  vmafNegHarmonicMean: finite.nullish().transform(absent),
  cambi: finite.nullish().transform(absent),
  onHull: z.boolean().nullish().transform(absent),
  cambiPenaltyWeight: finite.nullish().transform(absent),
  setting: setting.nullish().transform(absent),
  elapsedMs: finite.nullish().transform(absent),
  error: z.string().nullish().transform(absent),
}) satisfies z.ZodType<EncodeGridPoint>;

const derivedVariant = z.object({
  label: z.string(),
  resolution: z.string(),
  bitrate: z.string(),
  bitrateBps: finite,
  predictedVmaf: finite.nullish().transform(absent),
  predictedVmafHarmonic: finite.nullish().transform(absent),
  predictedVmafMin: finite.nullish().transform(absent),
  predictedCambi: finite.nullish().transform(absent),
  setting: setting.nullish().transform(absent),
  crf: z.number().nullish().transform(absent),
  hullSlope: finite.nullish().transform(absent),
  onEnvelope: z.boolean().nullish().transform(absent),
  hullDeficit: finite.nullish().transform(absent),
  placement: z
    .enum(["lambda", "window", "cap", "spacing", "floor", "cambi", "gap", "top"])
    .nullish()
    .transform(absent),
  cambiLimit: z.enum(["met", "binding", "cambi-unmet"]).nullish().transform(absent),
  lambdaPointBps: finite.nullish().transform(absent),
  intervalLowBps: finite.nullish().transform(absent),
  intervalHighBps: finite.nullish().transform(absent),
  interpolatedBetweenCrf: z.array(z.number()).nullish().transform(absent),
  atGridBoundary: z.boolean().nullish().transform(absent),
  fallback: z.boolean().nullish().transform(absent),
}) satisfies z.ZodType<DerivedLadderVariant>;

const derivedLadder = z.object({
  name: z.string(),
  variants: z.array(derivedVariant),
  lambda: finite.nullish().transform(absent),
  lambdaRule: z.enum(["base", "ceiling", "floor", "reachable"]).nullish().transform(absent),
  lambdaBase: finite.nullish().transform(absent),
  topRungFloor: finite.nullish().transform(absent),
  topRungCeiling: finite.nullish().transform(absent),
  bitrateFloorBps: finite.nullish().transform(absent),
  crossoverBps: z.record(z.string(), finite).nullish().transform(absent),
  crossovers: z
    .array(z.object({ key: z.string(), bitrateBps: finite, extrapolated: z.boolean() }))
    .nullish()
    .transform(absent),
  dropped: z.record(z.string(), z.string()).nullish().transform(absent),
  warnings: z.array(z.string()).nullish().transform(absent),
  qualityFloor: finite.nullish().transform(absent),
  cambiPenaltyWeight: finite.nullish().transform(absent),
  pooled: z.boolean().nullish().transform(absent),
  cambiLimit: z.enum(["TopRung", "AtLeast720p"]).nullish().transform(absent),
  maxPredictedCambi: finite.nullish().transform(absent),
}) satisfies z.ZodType<DerivedLadderDocument>;

const comparisonPoint = z.object({
  label: z.string(),
  bitrateBps: finite,
  vmafHarmonicMean: finite,
  vmafMean: finite,
  cambi: finite.nullish().transform(absent),
});

const ladderComparison = z.object({
  ladders: z.array(
    z.object({
      ladderKind: z.string(),
      label: z.string(),
      bdRatePercent: z.number(),
      overlapLowVmaf: z.number(),
      overlapHighVmaf: z.number(),
      bdRateHighBandPercent: z.number().nullish().transform(absent),
      bitrateSavingPercent: z.number().nullish().transform(absent),
      vmafGainAtEqualBitrate: z.number().nullish().transform(absent),
      bdVmaf: z.number().nullish().transform(absent),
      points: z.array(comparisonPoint),
      error: z.string().nullish().transform(absent),
    }),
  ),
  staticPoints: z.array(comparisonPoint),
}) satisfies z.ZodType<LadderComparisonDocument>;

const tuningComparison = z.object({
  tune: z.string().nullish().transform(absent),
  decimate: z.boolean(),
  bdRatePercent: z.number().nullish().transform(absent),
  bdRateByResolution: z.record(z.string(), z.number()).nullish().transform(absent),
  meanVmafDelta: z.number().nullish().transform(absent),
  meanCambiDelta: z.number().nullish().transform(absent),
  pairs: z.array(
    z.object({
      label: z.string(),
      height: z.number().int(),
      crf: z.number(),
      baseVmaf: finite,
      tunedVmaf: finite,
      vmafDelta: finite,
      baseCambi: finite.nullish().transform(absent),
      tunedCambi: finite.nullish().transform(absent),
      baseBitrateBps: finite,
      tunedBitrateBps: finite,
    }),
  ),
  error: z.string().nullish().transform(absent),
}) satisfies z.ZodType<TuningComparisonDocument>;

const packagingIntegrity = z.object({
  passed: z.boolean(),
  segmentTablesIdentical: z.boolean(),
  forcedKeyframesAligned: z.boolean().nullish().transform(absent),
  problems: z.array(z.string()),
  rungs: z.array(z.object({ label: z.string() }).loose()),
}) satisfies z.ZodType<PackagingIntegrityDocument>;

export const analysisSeries = z.object({
  siti: sitiSeries.nullish().transform(absent),
  packagingIntegrity: packagingIntegrity.nullish().transform(absent),
  animationLadderSensitivity: z
    .array(
      z.object({
        weight: finite,
        lambda: finite.nullish().transform(absent),
        variants: z.array(derivedVariant),
        error: z.string().nullish().transform(absent),
      }),
    )
    .nullish()
    .transform(absent),
  sourceCambi: finite.nullish().transform(absent),
  sourceCambiMax: finite.nullish().transform(absent),
  stageTimings: z
    .record(
      z.string(),
      z.object({
        durationMs: finite,
        frames: z.number().nullish().transform(absent),
        pixels: z.number().nullish().transform(absent),
        count: z.number().nullish().transform(absent),
      }),
    )
    .nullish()
    .transform(absent),
  sitiByFormat: byFormat(sitiSeries).nullish().transform(absent),
  vmafByFormat: byFormat(vmafSeries).nullish().transform(absent),
  encodeGrid: z.array(encodeGridPoint).nullish().transform(absent),
  encodeGridAnimation: z.array(encodeGridPoint).nullish().transform(absent),
  derivedLadder: derivedLadder.nullish().transform(absent),
  animationLadder: derivedLadder.nullish().transform(absent),
  ladderComparison: ladderComparison.nullish().transform(absent),
  tuningComparison: tuningComparison.nullish().transform(absent),
  duplicateFrameShare: z.number().min(0).max(1).nullish().transform(absent),
}) satisfies z.ZodType<AnalysisSeriesDocument>;

export const analysisTarget = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["source", "transcode"]),
  status: sectionStatus,
  transcodeId: z.string().nullish().transform(absent),
  ladderKind: ladderKind.nullish().transform(absent),
  tree: z.object({ id: z.string(), label: z.string(), children: z.array(treeNode) }),
  series: analysisSeries,
}) satisfies z.ZodType<AnalysisTarget>;

export const analysisResponse = z.object({
  routeId: z.string(),
  schemaVersion: z.number().int(),
  updatedAtUtc: isoDate.nullable(),
  targets: z.array(analysisTarget),
}) satisfies z.ZodType<VideoAnalysisResponse>;

/** Parses `data` with `schema`, failing with every mismatch listed by path. */
export function expectSchema<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `${label} does not match the frontend's type:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
