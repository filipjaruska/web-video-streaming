import type { AbrAlgorithm, StreamingMethod } from "@/types/streaming";

/**
 * Network a run is played under. Applied by the server to every request of the run — see
 * backend/Api/Streaming/NetworkShaping.cs, whose table has to match the rates and delays here — and
 * recorded on every result, because a measurement is meaningless without it.
 */
export type NetworkProfile = "standard" | "fourG" | "threeG" | "variable";

/** A profile with one fixed shape; the variable one moves between these over time. */
export type ShapedProfile = Exclude<NetworkProfile, "variable">;

/**
 * Shown in the UI, in megabits per second like every other rate in the app. Loss is emulated by its
 * cost — a lost packet crosses the link twice and the transfer waits one round trip — since a server
 * cannot drop a TCP segment.
 */
export const NETWORK_PROFILE_LABELS: Record<NetworkProfile, string> = {
  standard: "Standard (unshaped)",
  fourG: "4G — 20 Mb/s, 40 ms, 1 % loss",
  threeG: "3G — 2 Mb/s, 100 ms, 5 % loss",
  variable: "Variable — 4G → 3G → 4G",
};

/**
 * The variable-network run's timeline, from the moment playback is requested.
 *
 * Every phase is shaped. Starting unshaped would let the player fetch the whole 30 s clip within a
 * second, leaving the later phases nothing to act on. The drop to 3G lands mid-clip, and recovery is
 * timed from it until the player regains its rung once 4G returns.
 */
export const VARIABLE_NETWORK_SCHEDULE: ReadonlyArray<{ fromMs: number; profile: ShapedProfile }> = [
  { fromMs: 0, profile: "fourG" },
  { fromMs: 5_000, profile: "threeG" },
  { fromMs: 18_000, profile: "fourG" },
];

/** The fixed profile in force `elapsedMs` into a run. */
export function effectiveProfile(profile: NetworkProfile, elapsedMs: number): ShapedProfile {
  if (profile !== "variable") {
    return profile;
  }

  let current = VARIABLE_NETWORK_SCHEDULE[0].profile;
  for (const phase of VARIABLE_NETWORK_SCHEDULE) {
    if (elapsedMs >= phase.fromMs) {
      current = phase.profile;
    }
  }

  return current;
}

/**
 * The rate each profile declares, bits per second — what the server holds the link to. Null where
 * there is no single cap: the unshaped network, and a variable run that moves between profiles.
 */
export const NETWORK_PROFILE_RATE_BPS: Record<NetworkProfile, number | null> = {
  standard: null,
  fourG: 20_000_000,
  threeG: 2_000_000,
  variable: null,
};

/**
 * How far above its profile's declared rate a configuration's measured throughput may go before it
 * is flagged. Player estimates are noisy, so a shaped link can read somewhat above its cap; well
 * above it means the shaping did not happen — a backend deployed without it, say — and the runs do
 * not describe the network they are recorded under.
 */
export const THROUGHPUT_MISMATCH_FACTOR = 1.5;

/** True when a measured throughput is too far above the profile's declared rate to be that network. */
export function exceedsProfileRate(
  profile: NetworkProfile,
  throughputBps: number | null | undefined,
): boolean {
  const rate = NETWORK_PROFILE_RATE_BPS[profile];
  return rate !== null && !!throughputBps && throughputBps > rate * THROUGHPUT_MISMATCH_FACTOR;
}

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

/** A packaged ladder a sweep can play, and the protocols it was packaged for. */
export interface BenchmarkLadder {
  transcodeId: string;
  ladderKind: string;
  hasHls: boolean;
  hasDash: boolean;
}

/** What one sweep measures; every combination of the chosen ladders, protocols and rules. */
export interface BenchmarkSelection {
  ladders: BenchmarkLadder[];
  protocols: Array<"hls" | "dash">;
  algorithms: AbrAlgorithm[];
  /** Also play the original file over HTTP Range, the non-adaptive reference — once, not per ladder. */
  includeSource: boolean;
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

/**
 * The ladder a run played: its top rung and, keyed by height, each rung's measured harmonic VMAF and
 * measured average video bitrate.
 */
export interface LadderQuality {
  topHeight: number;
  vmafByHeight: Record<number, number>;
  /** Absent for ladders analysed before the measured bitrate was stored. */
  bitrateByHeight?: Record<number, number>;
}

/**
 * Per-run results kept inside the stored trace rather than in columns of their own, so adding them
 * needed no schema change. The server averages them from there.
 */
export interface BenchmarkTraceSummary {
  resolutionShare: Record<number, number>;
  topRungShare: number | null;
  timeWeightedVmaf: number | null;
  avgBufferSec: number;
  avgThroughputBps: number;
  sessionMs: number;
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
  /** Play() to the end of the clip, milliseconds: how long it took to play all of it, stalls included. */
  sessionMs: number;
  rebufferCount: number;
  rebufferMs: number;
  /** Stalled time as a fraction of time since the first frame. */
  bufferingRatio: number;
  /** Mean forward buffer over the samples taken while playing, seconds. */
  avgBufferSec: number;
  qualitySwitches: number;
  /** Direction reversals, not switches — a monotone climb oscillates zero times. */
  oscillations: number;
  /**
   * Bitrate of the rungs played, weighted by how long each was held, bits per second. Each rung's
   * measured average video bitrate where the ladder's analysis has it; otherwise the bitrate the
   * player reports, which for HLS and DASH is the declared peak including audio. For the source file,
   * the file's average bitrate.
   */
  timeWeightedBitrateBps: number;
  /**
   * Mean of the player's own throughput estimate while playing, bits per second; 0 when it never
   * reported one. A check on the conditions more than a result: it shows whether the link actually
   * ran at the rate the network profile declares.
   */
  avgThroughputBps: number;
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
