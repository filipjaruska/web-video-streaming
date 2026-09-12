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

/** How long fast start waits for its opening segment before dropping to the bottom rung. */
export const FAST_START_TIMEOUT_MS = 4000;

/**
 * The rung fast start opens on: the top one. Best mode only, never a measured profile.
 *
 * The measured profiles all open on the fixed start rung from `pickStartLevel`, so their runs are
 * comparable, and on a fast link that means a low first segment before the rules take over — and
 * hybrid then climbs only as fast as the buffer fills. That is the right choice for a measurement
 * and the wrong first impression for a viewer.
 *
 * Deliberately not the browser's downlink hint (Network Information API). It is coarse, capped at
 * 10 Mb/s in Chromium, and blind to local traffic: served from localhost it reported 1.25 Mb/s and
 * "3g", which opened on the bottom rung — and on localhost hls.js buffers the whole clip at that
 * rung before the first decision, so the opening segment played at 360p regardless. What protects
 * a genuinely slow link is the driver's timeout, which drops to the bottom rung if the opening
 * segment has not arrived within `FAST_START_TIMEOUT_MS`.
 */
export function pickFastStartLevel<T>(
  levels: readonly T[],
  bitrateOf: (level: T) => number,
): T | undefined {
  return levels.reduce<T | undefined>(
    (top, level) => (top === undefined || bitrateOf(level) > bitrateOf(top) ? level : top),
    undefined,
  );
}

/** Query parameter a benchmark run adds to every request, so the browser's HTTP cache cannot answer it. */
export const CACHE_BUST_PARAM = "bench";

/**
 * Adds the benchmark run's token to a URL, once.
 *
 * Without it repeated runs were served from the browser's cache — the API sent no Cache-Control, so
 * Chrome kept segments for a tenth of their age — and never crossed the network clumsy was shaping.
 */
export function withCacheBust(url: string, token: string | null): string {
  if (!token || url.includes(`${CACHE_BUST_PARAM}=`)) {
    return url;
  }

  return `${url}${url.includes("?") ? "&" : "?"}${CACHE_BUST_PARAM}=${encodeURIComponent(token)}`;
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
    // With automatic selection on — which the rule-driven controller needs — hls.js would otherwise
    // load the first fragment of the lowest rung as a bandwidth test before the chosen start rung.
    testBandwidth: false,
  };

  return baseConfig;
}

export interface DashSettings {
  streaming?: {
    cacheLoadThresholds?: {
      video?: number;
      audio?: number;
    };
    abr?: {
      autoSwitchBitrate?: {
        video?: boolean;
        audio?: boolean;
      };
    };
    buffer?: {
      fastSwitchEnabled?: boolean;
      bufferTimeDefault?: number;
      bufferTimeAtTopQuality?: number;
      bufferToKeep?: number;
    };
  };
}

export function createDashSettings(abrAlgorithm: AbrAlgorithm): DashSettings {
  return {
    streaming: {
      // dash.js treats a segment that arrives within 10 ms (5 ms for audio) as served from the
      // browser cache and leaves it out of its throughput estimate; hls.js has no such rule. Served
      // from nearby, most segments fell under it, the estimate sat at its opening default until one
      // happened to be slower, and repeated throughput runs landed anywhere from a fifth to four
      // fifths of the clip on the top rung. Benchmark runs cannot hit the cache — every request
      // carries the run's token — so the rule only ever discarded real measurements.
      cacheLoadThresholds: {
        video: 0,
        audio: 0,
      },
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
        // Off on every profile. Replacing already-buffered segments on an upward switch has no
        // counterpart on HLS, where a switch applies from the next segment, so leaving it on made
        // the protocols differ in exactly the behaviour being compared — and each replacement
        // emptied the video buffer ahead of the playhead, freezing the picture while it refilled.
        fastSwitchEnabled: false,
        // dash.js keeps two targets: 18 s by default below the top rung and 30 s at it, where
        // hls.js fills the same maxBufferLength on every rung. Left at the default, the buffer rule
        // — anchored to this same 30 s — could never see more than 18 s on DASH below the top rung,
        // and read that as a buffer never full enough to climb.
        bufferTimeDefault: TARGET_BUFFER_SEC,
        bufferTimeAtTopQuality: TARGET_BUFFER_SEC,
      },
    },
  };
}
