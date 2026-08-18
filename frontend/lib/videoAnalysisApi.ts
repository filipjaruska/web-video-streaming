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
  /** Point lies on the convex hull spanning every resolution. */
  onHull?: boolean;
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
}

export interface DerivedLadderDocument {
  name: string;
  variants: DerivedLadderVariant[];
  /** Lagrange multiplier every rung was selected at. */
  lambda?: number;
  /** Bitrate where the hull hands over between resolutions, keyed "1080p>720p". */
  crossoverBps?: Record<string, number>;
  /** Grid was scored on an SI/TI-selected excerpt rather than the whole clip. */
  windowed?: boolean;
}

export interface LadderComparisonPoint {
  label: string;
  bitrateBps: number;
  vmafHarmonicMean: number;
  vmafMean: number;
}

export interface LadderComparisonDocument {
  /** Negative means the derived ladder delivers equal quality for fewer bits. */
  bdRatePercent: number;
  overlapLowVmaf: number;
  overlapHighVmaf: number;
  bitrateSavingPercent?: number;
  vmafGainAtEqualBitrate?: number;
  staticPoints: LadderComparisonPoint[];
  dynamicPoints: LadderComparisonPoint[];
  error?: string;
}

export interface AnalysisSeriesDocument {
  siti?: SitiSeriesData;
  sitiByFormat?: FormatSitiSeries;
  vmafByFormat?: FormatVmafSeries;
  encodeGrid?: EncodeGridPoint[];
  derivedLadder?: DerivedLadderDocument;
  ladderComparison?: LadderComparisonDocument;
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
  ladderKind?: "static" | "dynamic";
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

export async function getVideoAnalysis(
  apiUrl: string,
  routeId: string,
): Promise<VideoAnalysisResponse> {
  const res = await fetch(`${apiUrl}/api/videos/${routeId}/analysis`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to load video analysis: ${res.status}`);
  }

  return res.json() as Promise<VideoAnalysisResponse>;
}
