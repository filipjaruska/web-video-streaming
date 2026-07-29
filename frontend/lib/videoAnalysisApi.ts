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

export interface AnalysisSeriesDocument {
  siti?: SitiSeriesData;
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
  tree: AnalysisTreeDocument;
  series: AnalysisSeriesDocument;
}

export interface FutureTestDescriptor {
  id: string;
  label: string;
  status: "not_implemented";
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
