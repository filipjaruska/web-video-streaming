import type { LadderKind } from "@/lib/analysisFormat";

export type AnalysisSectionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "notImplemented";

export interface AnalysisTreeNodeMeta {
  source?: string;
  status?: AnalysisSectionStatus;
  error?: string;
  /** "section" = structural group; "series" = legacy (filtered out by normalizer). */
  kind?: "section" | "series";
}

export interface AnalysisTreeNode {
  id: string;
  label: string;
  value?: string | null;
  meta?: AnalysisTreeNodeMeta;
  children?: AnalysisTreeNode[];
}

export interface AnalysisTreeDocument {
  id: string;
  label: string;
  children: AnalysisTreeNode[];
}

export interface SitiSeriesData {
  si: number[];
  ti: number[];
  timeSec?: number[];
}

export interface FormatSitiSeries {
  hls?: Record<string, SitiSeriesData>;
  dash?: Record<string, SitiSeriesData>;
}

export interface VmafSummary {
  mean: number;
  harmonicMean: number;
  min: number;
  max: number;
  model?: string;
  width?: number;
  height?: number;
  /** Bitrate measured on the scored file. */
  bitrateBps?: number;
  /** Bitrate the rung was asked to hit — x264 does not land exactly on it. */
  targetBitrateBps?: number;
  /** Mean CAMBI banding score. Higher is worse; a clean source sits near zero. */
  cambi?: number;
  cambiMax?: number;
}

export interface VmafSeriesData {
  scores: number[];
  timeSec?: number[];
  summary: VmafSummary;
  /** Pooled stats per VMAF model ("vmaf" and "neg"), scored in one libvmaf pass. */
  summaryByModel?: Record<string, VmafSummary>;
}

export interface FormatVmafSeries {
  hls?: Record<string, VmafSeriesData>;
  dash?: Record<string, VmafSeriesData>;
}

export interface EncodeGridPoint {
  label: string;
  width: number;
  height: number;
  crf: number;
  bitrateBps: number;
  vmafMean: number;
  vmafHarmonicMean?: number;
  vmafMin?: number;
  vmafNegMean?: number;
  vmafNegHarmonicMean?: number;
  cambi?: number;
  /** Point lies on the convex hull spanning every resolution. */
  onHull?: boolean;
  /** CAMBI penalty the ladder decision used for this point (0 on the generic grid). */
  cambiPenaltyWeight?: number;
  /** Wall time of the encode and its VMAF, milliseconds. */
  elapsedMs?: number;
  error?: string;
}

export interface DerivedLadderVariant {
  label: string;
  resolution: string;
  bitrate: string;
  bitrateBps: number;
  predictedVmaf?: number;
  predictedVmafHarmonic?: number;
  predictedVmafMin?: number;
  crf?: number;
  /** Local hull slope, in VMAF per doubling of bitrate. */
  hullSlope?: number;
  /** The rung lies on the envelope of every resolution's hull at its bitrate. */
  onEnvelope?: boolean;
  /** VMAF the best resolution would add at this bitrate; 0 on the envelope. */
  hullDeficit?: number;
  /** Held below the crossover above which the next resolution up wins. */
  capped?: boolean;
  capBps?: number;
  /** On the grid's lowest CRF with the hull still steeper than λ — the tangent lies past the grid. */
  atGridBoundary?: boolean;
  /** No usable grid sample at this resolution; the static rung was kept. */
  fallback?: boolean;
}

export interface DerivedLadderDocument {
  name: string;
  variants: DerivedLadderVariant[];
  /** Lagrange multiplier every rung was selected at. */
  lambda?: number;
  /** Bitrate where the hull hands over between resolutions, keyed "1080p>720p". */
  crossoverBps?: Record<string, number>;
  /** The same crossovers, ordered, with whether each was extrapolated past the lower curve. */
  crossovers?: CrossoverInfo[];
  /** Resolutions left out of the ladder, with the reason. */
  dropped?: Record<string, string>;
  /** Gaps between adjacent rungs wide enough to matter for ABR, and similar notes. */
  warnings?: string[];
  /** Harmonic VMAF below which grid points are left out of the hulls. */
  qualityFloor?: number;
  cambiPenaltyWeight?: number;
}

export interface CrossoverInfo {
  /** "upper>lower": the resolution winning above the bitrate, then the one below it. */
  key: string;
  bitrateBps: number;
  extrapolated: boolean;
}

/** The animation ladder re-derived from the same grid under another CAMBI weight. */
export interface LadderSensitivityEntry {
  weight: number;
  lambda?: number;
  variants: DerivedLadderVariant[];
  error?: string;
}

export interface LadderComparisonPoint {
  label: string;
  bitrateBps: number;
  vmafHarmonicMean: number;
  vmafMean: number;
  cambi?: number;
}

export interface LadderComparisonEntry {
  /** "dynamic" | "animation" */
  ladderKind: string;
  label: string;
  /** Negative means this ladder delivers equal quality for fewer bits than static. */
  bdRatePercent: number;
  overlapLowVmaf: number;
  overlapHighVmaf: number;
  /** BD-rate integrated only over harmonic VMAF ≥ 60, the range viewers are actually served at. */
  bdRateHighBandPercent?: number;
  bitrateSavingPercent?: number;
  vmafGainAtEqualBitrate?: number;
  points: LadderComparisonPoint[];
  error?: string;
}

export interface LadderComparisonDocument {
  ladders: LadderComparisonEntry[];
  staticPoints: LadderComparisonPoint[];
}

export interface TuningComparisonPair {
  label: string;
  height: number;
  crf: number;
  baseVmaf: number;
  tunedVmaf: number;
  vmafDelta: number;
  baseCambi?: number;
  tunedCambi?: number;
  baseBitrateBps: number;
  tunedBitrateBps: number;
}

export interface TuningComparisonDocument {
  tune?: string;
  decimate: boolean;
  /** Mean of the per-resolution BD-rates below. */
  bdRatePercent?: number;
  /** BD-rate fitted separately at each resolution, keyed by rung label. */
  bdRateByResolution?: Record<string, number>;
  meanVmafDelta?: number;
  meanCambiDelta?: number;
  pairs: TuningComparisonPair[];
  error?: string;
}

export interface StageTiming {
  durationMs: number;
  frames?: number;
  pixels?: number;
  count?: number;
}

export interface PackagingIntegrityRung {
  label: string;
  renditionSha256?: string;
  hlsSha256?: string;
  dashSha256?: string;
  renditionPackets?: number;
  hlsPackets?: number;
  dashPackets?: number;
  hlsSegmentsSec?: number[];
  dashSegmentsSec?: number[];
  hlsAvDeltaMs?: number;
  dashAvDeltaMs?: number;
  hlsBandwidthBps?: number;
  hlsAverageBandwidthBps?: number;
  dashBandwidthBps?: number;
  averageBps?: number;
  peakSegmentBps?: number;
}

/** Proof that HLS and DASH carry the one encoded bitstream per rung. */
export interface PackagingIntegrityDocument {
  passed: boolean;
  segmentTablesIdentical: boolean;
  problems: string[];
  rungs: PackagingIntegrityRung[];
}

export interface AnalysisSeriesDocument {
  siti?: SitiSeriesData;
  packagingIntegrity?: PackagingIntegrityDocument;
  animationLadderSensitivity?: LadderSensitivityEntry[];
  /** CAMBI of the source against itself — the banding already present before encoding. */
  sourceCambi?: number;
  sourceCambiMax?: number;
  /** Wall time per pipeline step, keyed by step name. */
  stageTimings?: Record<string, StageTiming>;
  sitiByFormat?: FormatSitiSeries;
  vmafByFormat?: FormatVmafSeries;
  encodeGrid?: EncodeGridPoint[];
  encodeGridAnimation?: EncodeGridPoint[];
  derivedLadder?: DerivedLadderDocument;
  animationLadder?: DerivedLadderDocument;
  ladderComparison?: LadderComparisonDocument;
  tuningComparison?: TuningComparisonDocument;
  /** Share of source frames identical to their predecessor — animation shot "on twos". */
  duplicateFrameShare?: number;
}

export type AnalysisTargetKind = "source" | "transcode" | "futureTest";

export type AnalysisTargetStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "not_implemented";

export interface AnalysisTarget {
  id: string;
  label: string;
  kind: AnalysisTargetKind;
  status: AnalysisTargetStatus;
  transcodeId?: string;
  ladderKind?: LadderKind;
  tree: AnalysisTreeDocument;
  series: AnalysisSeriesDocument;
}

export interface FutureTestDescriptor {
  id: string;
  label: string;
  status: AnalysisTargetStatus;
}

export interface VideoAnalysisResponse {
  routeId: string;
  schemaVersion: number;
  updatedAtUtc: string | null;
  targets: AnalysisTarget[];
  futureTests: FutureTestDescriptor[];
}

/**
 * @param init Defaults to uncached, which is what the live per-video view needs while a pipeline
 * is still writing. Server-rendered callers that only summarise finished work should pass a
 * revalidating config instead of re-fetching a multi-megabyte document on every navigation.
 */
export async function getVideoAnalysis(
  apiUrl: string,
  routeId: string,
  init: RequestInit = { cache: "no-store" },
): Promise<VideoAnalysisResponse> {
  const res = await fetch(`${apiUrl}/api/videos/${routeId}/analysis`, init);

  if (!res.ok) {
    throw new Error(`Failed to load video analysis: ${res.status}`);
  }

  return res.json() as Promise<VideoAnalysisResponse>;
}
