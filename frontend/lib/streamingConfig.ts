import type Hls from "hls.js";
import type { AbrAlgorithm } from "@/types/streaming";

/**
 * Buffer every profile is asked to keep, seconds. Shared by both protocols and handed to the ABR
 * rules as their target, so the buffer rule is anchored to the same figure the player is filling.
 */
export const TARGET_BUFFER_SEC = 30;

/** Segment length the ladders are packaged at, used where a player cannot report it. */
export const SEGMENT_SEC = 6;

/**
 * Opening throughput estimate, bits per second.
 *
 * hls.js defaults to 500 kb/s, which sits below even the lowest rung of the static ladder and makes
 * every run open at the bottom. Starting near the middle of the ladder lets the estimate converge
 * on the real link rather than climb the whole way from underneath it.
 */
export const INITIAL_BANDWIDTH_BPS = 2_000_000;

/** Share of the opening estimate the starting rung's declared bitrate may take. */
export const START_BANDWIDTH_FRACTION = 0.9;

/**
 * The rung every adaptive profile starts on: the highest one whose declared bitrate fits the
 * opening estimate, else the lowest.
 *
 * Pinned rather than left to the player's opening guess. Test clips run tens of seconds, so a
 * player starting at the bottom and climbing spends a large share of the clip in that ramp, and
 * switch counts and time-weighted quality would describe the ramp instead of the algorithm. It used
 * to be pinned by index — third rung from the bottom — which lands on a different bitrate on every
 * ladder once derived ladders drop a rung, so the ladders being compared did not start on equal
 * terms. On the static ladder both rules pick 480p.
 */
export function pickStartLevel<T>(
  levels: readonly T[],
  bitrateOf: (level: T) => number,
): T | undefined {
  const budget = INITIAL_BANDWIDTH_BPS * START_BANDWIDTH_FRACTION;
  const ascending = [...levels].sort((a, b) => bitrateOf(a) - bitrateOf(b));
  const fitting = ascending.filter((level) => bitrateOf(level) <= budget);
  return fitting.at(-1) ?? ascending[0];
}

/**
 * hls.js configuration, identical for every profile.
 *
 * Quality is selected by the rules in `lib/abr`, identically on both protocols, so hls.js's own ABR
 * contributes nothing beyond the throughput estimate the rules read back from it. The profile is
 * applied by the driver rather than here, which is why no algorithm is taken as an argument.
 */
export function createHlsConfig(): Partial<Hls["config"]> {
  const baseConfig: Partial<Hls["config"]> = {
    debug: false,
    enableWorker: true,
    lowLatencyMode: false,
    autoStartLoad: false,
    maxBufferLength: TARGET_BUFFER_SEC,
    abrEwmaDefaultEstimate: INITIAL_BANDWIDTH_BPS,
    capLevelToPlayerSize: false,
  };

  return baseConfig;
}

export interface DashSettings {
  streaming?: {
    abr?: {
      autoSwitchBitrate?: {
        video?: boolean;
        audio?: boolean;
      };
    };
    buffer?: {
      fastSwitchEnabled?: boolean;
      bufferTimeAtTopQuality?: number;
      bufferToKeep?: number;
    };
  };
}

export function createDashSettings(abrAlgorithm: AbrAlgorithm): DashSettings {
  return {
    streaming: {
      abr: {
        // Off for every profile, including the adaptive ones: dash.js's built-in rules are replaced
        // by the shared implementation so that the protocol, and not the algorithm, is what differs
        // between an HLS and a DASH measurement.
        autoSwitchBitrate: {
          video: false,
          audio: false,
        },
      },
      buffer: {
        // Lets an upward switch replace already-buffered segments instead of waiting for them to
        // drain. With a 30 s buffer the previous setting delayed a recovery by up to 30 s, which is
        // the very quantity the variable-network measurement is trying to observe.
        fastSwitchEnabled: abrAlgorithm !== "baseline",
        bufferTimeAtTopQuality: TARGET_BUFFER_SEC,
      },
    },
  };
}
