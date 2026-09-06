import type { AbrAlgorithm, StreamingMethod } from "@/types/streaming";

/**
 * Network condition the operator has configured in clumsy for a run.
 *
 * Page JavaScript cannot shape the link, so this is a declared label rather than something the app
 * enforces. It is recorded on every result because a measurement is meaningless without it.
 */
export type NetworkProfile = "standard" | "fourG" | "threeG" | "variable";

export const NETWORK_PROFILE_LABELS: Record<NetworkProfile, string> = {
  standard: "Standardní (nedegradovaná)",
  fourG: "4G — 8000 kb/s, 40 ms, 1 %",
  threeG: "3G — 2000 kb/s, 100 ms, 5 %",
  variable: "Proměnlivá síť",
};

/** One measured configuration: which ladder, delivered how, decided by which rule. */
export interface BenchmarkCell {
  /** Packaging run being played, or null for the original source over HTTP Range. */
  transcodeId: string | null;
  ladderKind: string;
  protocol: StreamingMethod;
  algorithm: AbrAlgorithm;
}

/** One sample of the player's state, taken on a fixed cadence during a run. */
export interface BenchmarkSample {
  /** Milliseconds since the run started. */
  atMs: number;
  /** Media time, seconds — distinct from `atMs`, which keeps running through a stall. */
  playbackSec: number;
  bufferSec: number;
  bandwidthBps: number;
  /** Bitrate of the rung currently selected. */
  bitrateBps: number;
  /** Ladder position, ascending by bitrate. -1 when unknown. */
  rungIndex: number;
  droppedFrames: number;
  totalFrames: number;
}

export type BenchmarkEvent =
  /** First frame rendered. Everything before this is startup, not rebuffering. */
  | { kind: "startup"; atMs: number }
  | { kind: "rebufferStart"; atMs: number }
  | { kind: "rebufferEnd"; atMs: number }
  | { kind: "networkTransition"; atMs: number; profile: NetworkProfile }
  | { kind: "ended"; atMs: number }
  | { kind: "error"; atMs: number; message: string };

/** Everything one playback produced, before any metric is derived from it. */
export interface BenchmarkTrace {
  samples: BenchmarkSample[];
  events: BenchmarkEvent[];
  /** Wall-clock length of the run, milliseconds. */
  durationMs: number;
}

export interface BenchmarkMetrics {
  /** Play() to first frame, milliseconds. Null when the run never started. */
  startupMs: number | null;
  rebufferCount: number;
  rebufferMs: number;
  /** Stalled time as a fraction of time since the first frame. */
  bufferingRatio: number;
  qualitySwitches: number;
  /** Direction reversals, not switches — a monotone climb oscillates zero times. */
  oscillations: number;
  timeWeightedBitrateBps: number;
  droppedFrameRatio: number;
  /**
   * Time from a network degradation to sustained recovery, milliseconds.
   * Null when no transition was marked, or when quality never dropped after one.
   */
  recoveryMs: number | null;
}

export interface BenchmarkRunResult {
  cell: BenchmarkCell;
  networkProfile: NetworkProfile;
  repetition: number;
  metrics: BenchmarkMetrics;
  trace: BenchmarkTrace;
  failed: boolean;
  errorMessage?: string;
}
