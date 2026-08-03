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
  bitrateBps?: number;
}

export interface VmafSeriesData {
  scores: number[];
  timeSec?: number[];
  summary: VmafSummary;
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
  error?: string;
}

export interface DerivedLadderVariant {
  label: string;
  resolution: string;
  bitrate: string;
  bitrateBps: number;
  predictedVmaf?: number;
}

export interface DerivedLadderDocument {
  name: string;
  variants: DerivedLadderVariant[];
}

export interface AnalysisSeriesDocument {
  siti?: SitiSeriesData;
  sitiByFormat?: FormatSitiSeries;
  vmafByFormat?: FormatVmafSeries;
  encodeGrid?: EncodeGridPoint[];
  derivedLadder?: DerivedLadderDocument;
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
