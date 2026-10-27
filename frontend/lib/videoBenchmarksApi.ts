import { currentDocument } from "@/lib/env";
import type { BenchmarkTrace, BenchmarkTraceSummary, NetworkProfile } from "@/lib/benchmark/types";
import { fromServerProfile } from "@/lib/benchmark/types";

/** One measured playback, as stored. Mirrors `BenchmarkRunDto` on the backend. */
export interface BenchmarkRunDto {
  id: string;
  /** The packaging run played; null for the source file over HTTP Range. */
  transcodeId?: string | null;
  mode: string;
  /** Server enum name — `"Standard"`, `"FourG"`, `"ThreeG"`, `"Variable"`. */
  networkProfile: string;
  ladderKind: string;
  protocol: string;
  abrAlgorithm: string;
  repetition: number;
  startupMs?: number | null;
  bufferingRatio: number;
  rebufferCount: number;
  rebufferMs: number;
  qualitySwitches: number;
  oscillations: number;
  timeWeightedBitrateBps: number;
  droppedFrameRatio: number;
  recoveryMs?: number | null;
  failed: boolean;
  errorMessage?: string | null;
  createdAtUtc: string;
}

/** Mean and spread over one cell's repetitions — one row of a results table. */
export interface BenchmarkAggregateDto {
  networkProfile: string;
  ladderKind: string;
  protocol: string;
  abrAlgorithm: string;
  runs: number;
  startupMsMean: number;
  startupMsStdDev: number;
  bufferingRatioMean: number;
  bufferingRatioStdDev: number;
  qualitySwitchesMean: number;
  oscillationsMean: number;
  timeWeightedBitrateBpsMean: number;
  recoveryMsMean?: number | null;
  /** Stalled time after the first frame, milliseconds. */
  rebufferMsMean: number;
  rebufferCountMean: number;
  /** Delivered quality: played rungs' harmonic VMAF, weighted by time. Absent for older runs and the source cell. */
  timeWeightedVmafMean?: number | null;
  timeWeightedVmafStdDev?: number | null;
  /** Mean share of played time at the ladder's top rung. */
  topRungShareMean?: number | null;
  /** Mean share of played time per rendition height, keyed by height. */
  resolutionShareMean?: Record<string, number> | null;
  droppedFrameRatioMean?: number | null;
  /** Mean forward buffer while playing, seconds. Absent for older runs. */
  avgBufferSecMean?: number | null;
  /** The player's own throughput estimate, averaged — what the link actually delivered. */
  avgThroughputBpsMean?: number | null;
  /** Play request to the end of the video, milliseconds. */
  sessionMsMean?: number | null;
  sessionMsStdDev?: number | null;
}

export interface VideoBenchmarksResponse {
  routeId: string;
  schemaVersion: number;
  runs: BenchmarkRunDto[];
  aggregates: BenchmarkAggregateDto[];
}

/** One run's identity and the trace its runner recorded. */
export interface BenchmarkTraceDto {
  id: string;
  transcodeId?: string | null;
  networkProfile: string;
  ladderKind: string;
  protocol: string;
  abrAlgorithm: string;
  repetition: number;
  failed: boolean;
  /** Null for runs posted without a trace. */
  trace: (BenchmarkTrace & { summary?: Partial<BenchmarkTraceSummary> }) | null;
}

export interface VideoBenchmarkTracesResponse {
  routeId: string;
  schemaVersion: number;
  runs: BenchmarkTraceDto[];
}

/** Every run's samples and events, for metrics derived from the trace itself (steady state). */
export async function getVideoBenchmarkTraces(
  apiUrl: string,
  routeId: string,
  init: RequestInit = currentDocument(),
): Promise<VideoBenchmarkTracesResponse> {
  const res = await fetch(`${apiUrl}/api/videos/${routeId}/benchmarks/traces`, init);

  if (!res.ok) {
    throw new Error(`Failed to load benchmark traces: ${res.status}`);
  }

  return res.json() as Promise<VideoBenchmarkTracesResponse>;
}

/** Server enum name to the frontend's profile id, for labelling. */
export function profileOf(aggregate: { networkProfile: string }): NetworkProfile {
  return fromServerProfile(aggregate.networkProfile);
}

export async function getVideoBenchmarks(
  apiUrl: string,
  routeId: string,
  init: RequestInit = currentDocument(),
): Promise<VideoBenchmarksResponse> {
  const res = await fetch(`${apiUrl}/api/videos/${routeId}/benchmarks`, init);

  if (!res.ok) {
    throw new Error(`Failed to load benchmarks: ${res.status}`);
  }

  return res.json() as Promise<VideoBenchmarksResponse>;
}
