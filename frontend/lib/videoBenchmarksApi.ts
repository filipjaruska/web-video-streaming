import type { NetworkProfile } from "@/lib/benchmark/types";
import { fromServerProfile } from "@/lib/benchmark/types";

/** One measured playback, as stored. Mirrors `BenchmarkRunDto` on the backend. */
export interface BenchmarkRunDto {
  id: string;
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

/** Mean and spread over one cell's repetitions — the shape a chapter 5 table row takes. */
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
}

export interface VideoBenchmarksResponse {
  routeId: string;
  schemaVersion: number;
  runs: BenchmarkRunDto[];
  aggregates: BenchmarkAggregateDto[];
}

/** Server enum name to the frontend's profile id, for labelling. */
export function profileOf(aggregate: {
  networkProfile: string;
}): NetworkProfile {
  return fromServerProfile(aggregate.networkProfile);
}

export async function getVideoBenchmarks(
  apiUrl: string,
  routeId: string,
  init: RequestInit = { cache: "no-store" },
): Promise<VideoBenchmarksResponse> {
  const res = await fetch(`${apiUrl}/api/videos/${routeId}/benchmarks`, init);

  if (!res.ok) {
    throw new Error(`Failed to load benchmarks: ${res.status}`);
  }

  return res.json() as Promise<VideoBenchmarksResponse>;
}
