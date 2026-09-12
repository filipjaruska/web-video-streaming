import type { AbrAlgorithm, StreamingMethod } from "@/types/streaming";

/**
 * Network condition the operator has configured in clumsy for a run.
 *
 * Page JavaScript cannot shape the link, so this is a declared label rather than something the app
 * enforces. It is recorded on every result because a measurement is meaningless without it.
 */
export type NetworkProfile = "standard" | "fourG" | "threeG" | "variable";

/** Shown in the UI. The figures match what the operator sets in clumsy. */
export const NETWORK_PROFILE_LABELS: Record<NetworkProfile, string> = {
  standard: "Standard (unshaped)",
  fourG: "4G — 8000 kb/s, 40 ms, 1 % loss",
  threeG: "3G — 2000 kb/s, 100 ms, 5 % loss",
  variable: "Variable network",
};

/**
 * Written to CSV instead of the display label. Kept separate and stable so that rewording the UI
 * cannot change the contents of an exported column that analysis downstream is keyed on.
 */
export const NETWORK_PROFILE_CSV_IDS: Record<NetworkProfile, string> = {
  standard: "standard",
  fourG: "4g",
  threeG: "3g",
  variable: "variable",
};

/**
 * The server names these profiles differently — a C# enum, so `"FourG"` rather than `"fourG"`.
 * Both directions live here so they cannot drift apart.
 */
const SERVER_PROFILE_NAMES: Record<NetworkProfile, string> = {
  standard: "Standard",
  fourG: "FourG",
  threeG: "ThreeG",
  variable: "Variable",
};

export function toServerProfile(profile: NetworkProfile): string {
  return SERVER_PROFILE_NAMES[profile];
}

/** Unknown values fall back to `standard` rather than throwing — a label is not worth a crash. */
export function fromServerProfile(value: string): NetworkProfile {
  const match = (
    Object.entries(SERVER_PROFILE_NAMES) as Array<[NetworkProfile, string]>
  ).find(([, name]) => name.toLowerCase() === value?.toLowerCase());

  return match?.[0] ?? "standard";
}

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
  /** Height of the rendition on screen, pixels; 0 when unknown. Absent from traces recorded before it existed. */
  height?: number;
  droppedFrames: number;
  totalFrames: number;
}

/** The ladder a run played: its top rung and each rung's measured harmonic VMAF, keyed by height. */
export interface LadderQuality {
  topHeight: number;
  vmafByHeight: Record<number, number>;
}

/**
 * Per-run results kept inside the stored trace rather than in columns of their own, so adding them
 * needed no schema change. The server averages them from there.
 */
export interface BenchmarkTraceSummary {
  resolutionShare: Record<number, number>;
  topRungShare: number | null;
  timeWeightedVmaf: number | null;
  freezeCount: number;
  freezeRatio: number;
}

export type BenchmarkEvent =
  /** First frame rendered. Everything before this is startup, not rebuffering. */
  | { kind: "startup"; atMs: number }
  | { kind: "rebufferStart"; atMs: number }
  | { kind: "rebufferEnd"; atMs: number }
  /** A frozen picture while the element kept playing; `atMs` is the last frame before it. */
  | { kind: "freeze"; atMs: number; durationMs: number }
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
  /**
   * Frozen-picture episodes after the first frame: no new frame presented for at least the freeze
   * threshold while the element reported itself playing. Kept apart from rebuffering, which counts
   * only the stalls the element admits to with "waiting".
   */
  freezeCount: number;
  freezeMs: number;
  /** Frozen-picture time as a fraction of time since the first frame. */
  freezeRatio: number;
  qualitySwitches: number;
  /** Direction reversals, not switches — a monotone climb oscillates zero times. */
  oscillations: number;
  timeWeightedBitrateBps: number;
  /**
   * Share of the played media time spent at each rendition height, keyed by height. Weighted by
   * media time rather than wall time, so a stall adds nothing to the rung it happened on.
   */
  resolutionShare: Record<number, number>;
  /** Share of played media time at the ladder's top rung. Null when the ladder is unknown. */
  topRungShare: number | null;
  /**
   * Each played rung's measured harmonic VMAF, weighted by its share of played media time — the
   * quality the viewer received. Null when the ladder's scores are unknown.
   */
  timeWeightedVmaf: number | null;
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
