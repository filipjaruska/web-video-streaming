import type Hls from "hls.js";
import { FAST_START_TIMEOUT_MS, INITIAL_BANDWIDTH_BPS, SEGMENT_SEC } from "@/lib/streamingConfig";
import { type AbrLevel, type AbrState, decide } from "./rules";

export type AbrRuleName = "throughput" | "buffer" | "hybrid";

/**
 * How often a decision is taken, milliseconds.
 *
 * Both protocols are driven on the same clock rather than on their own segment events, so the two
 * are given the same number of opportunities to switch over a clip of a given length. Leaving each
 * player to decide on its own cadence would let switch counts differ for reasons that have nothing
 * to do with the algorithm.
 */
const TICK_MS = 1000;

/**
 * Share of one segment that must be buffered before fast start hands over to the rules. Just under
 * a whole segment, because a buffered range can end a few milliseconds short of the segment edge.
 */
const STARTUP_BUFFERED_FRACTION = 0.9;

export interface AbrDriver {
  stop(): void;
}

export interface DriverOptions {
  /**
   * Best mode's fast start. Holds the opening rung, with no rule applied, until its first segment
   * is buffered; drops straight to the bottom rung if that takes longer than
   * `FAST_START_TIMEOUT_MS`. Never set for a measured profile — see `pickFastStartLevel`.
   */
  fastStart?: boolean;
}

/**
 * Reads the state a rule needs out of one player and applies the rung it returns.
 *
 * The built-in ABR of each player is switched off by its adapter, so the rules in `rules.ts` are
 * the only thing selecting quality on either protocol.
 */
interface PlayerAdapter {
  readLevels(): AbrLevel[];
  readCurrentIndex(): number;
  readBandwidthBps(): number;
  readBufferSec(): number;
  readSegmentSec(): number;
  apply(index: number): void;
  /** Switches now, abandoning a segment already in flight — used only when fast start times out. */
  applyNow(index: number): void;
}

function run(
  adapter: PlayerAdapter,
  algorithm: AbrRuleName,
  targetBufferSec: number,
  options: DriverOptions = {},
): AbrDriver {
  const startedAt = performance.now();
  let startingUp = options.fastStart === true;

  const tick = () => {
    const levels = adapter.readLevels();
    if (levels.length === 0) {
      return;
    }

    const state: AbrState = {
      levels,
      currentIndex: adapter.readCurrentIndex(),
      bandwidthBps: adapter.readBandwidthBps(),
      bufferSec: adapter.readBufferSec(),
      targetBufferSec,
      segmentSec: adapter.readSegmentSec(),
    };

    if (startingUp) {
      // An empty buffer at startup is expected, not an emergency, and the throughput estimate is
      // still the configured default rather than a measurement — neither may move the opening rung.
      if (state.bufferSec >= state.segmentSec * STARTUP_BUFFERED_FRACTION) {
        startingUp = false;
      } else if (performance.now() - startedAt >= FAST_START_TIMEOUT_MS) {
        startingUp = false;
        const lowest = levels.reduce((low, level) => (level.bitrateBps < low.bitrateBps ? level : low));
        if (lowest.index !== state.currentIndex) {
          adapter.applyNow(lowest.index);
        }
        return;
      } else {
        return;
      }
    }

    // After a fast start the opening segment is the only measurement there is; until the player
    // reports an estimate from it, holding the rung beats reading "no estimate" as zero throughput.
    if (options.fastStart && !(state.bandwidthBps > 0)) {
      return;
    }

    const decision = decide(algorithm, state);
    if (decision.index !== state.currentIndex) {
      adapter.apply(decision.index);
    }
  };

  const handle = window.setInterval(tick, TICK_MS);
  tick();

  return {
    stop() {
      window.clearInterval(handle);
    },
  };
}

/** Forward buffer ahead of the playhead, in seconds. */
function bufferAhead(media: HTMLMediaElement | null | undefined): number {
  if (!media) {
    return 0;
  }

  const { buffered, currentTime } = media;
  for (let i = 0; i < buffered.length; i++) {
    if (currentTime >= buffered.start(i) && currentTime <= buffered.end(i)) {
      return buffered.end(i) - currentTime;
    }
  }

  return 0;
}

export function driveHls(
  hls: Hls,
  algorithm: AbrRuleName,
  targetBufferSec: number,
  options: DriverOptions = {},
): AbrDriver {
  const adapter: PlayerAdapter = {
    readLevels: () =>
      hls.levels.map((level, index) => ({
        index,
        bitrateBps: level.bitrate,
        height: level.height ?? 0,
      })),
    // loadLevel is the rung the next fragment will be fetched at, which is what a decision acts on.
    readCurrentIndex: () => (hls.loadLevel >= 0 ? hls.loadLevel : (hls.currentLevel ?? 0)),
    readBandwidthBps: () => hls.bandwidthEstimate,
    readBufferSec: () => bufferAhead(hls.media),
    // The packaging segment length, as on DASH. hls.js would report TARGETDURATION, the rounded-up
    // longest segment — 7 on ladders packaged before keyframes were forced — so reading it here
    // handed the buffer rule a different figure on each protocol for the same segments.
    readSegmentSec: () => SEGMENT_SEC,
    // Assigning nextLevel turns hls.js's own auto selection off and pins the choice, which is
    // exactly the handover wanted here.
    apply: (index) => {
      hls.nextLevel = index;
    },
    applyNow: (index) => {
      hls.currentLevel = index;
    },
  };

  return run(adapter, algorithm, targetBufferSec, options);
}

/** Minimal shape of the dash.js player, kept local so dashjs need not be imported at module load. */
interface DashPlayerLike {
  getRepresentationsByType?: (type: string) => Array<{
    index?: number;
    bandwidth?: number;
    height?: number;
  }>;
  setRepresentationForTypeByIndex?: (type: string, index: number, forceReplace?: boolean) => void;
  getCurrentRepresentationForType?: (type: string) => { index?: number } | null;
  getBufferLength?: (type: string) => number;
  getAverageThroughput?: (type: string) => number;
}

/** Declared bandwidth of the audio track a DASH video rung is played with; 0 when there is none. */
export function dashAudioBandwidth(player: DashPlayerLike): number {
  const audio = player.getRepresentationsByType?.("audio") ?? [];
  return audio.reduce((highest, representation) => Math.max(highest, representation.bandwidth ?? 0), 0);
}

export function driveDash(
  player: DashPlayerLike,
  algorithm: AbrRuleName,
  targetBufferSec: number,
  segmentSec: number,
  options: DriverOptions = {},
): AbrDriver {
  const representations = () => player.getRepresentationsByType?.("video") ?? [];

  const adapter: PlayerAdapter = {
    // Video plus audio, to match what hls.js reports: an HLS BANDWIDTH covers every stream the
    // variant plays, its audio group included, while an MPD @bandwidth covers one representation.
    // The backend declares both from the same measured peaks, so with the audio added the rules see
    // the same number per rung on either protocol.
    readLevels: () => {
      const audio = dashAudioBandwidth(player);
      return representations()
        .map((representation, position) => ({
          index: representation.index ?? position,
          bitrateBps: (representation.bandwidth ?? 0) > 0 ? (representation.bandwidth ?? 0) + audio : 0,
          height: representation.height ?? 0,
        }))
        .filter((level) => level.bitrateBps > 0);
    },
    readCurrentIndex: () => player.getCurrentRepresentationForType?.("video")?.index ?? 0,
    // dash.js reports throughput in kbps; the rules work in bits per second throughout. Until it has
    // measured a segment it reports 0, where hls.js reports its configured opening estimate — so
    // DASH is handed that same estimate until then, and both protocols start from identical inputs.
    readBandwidthBps: () => {
      const kbps = player.getAverageThroughput?.("video") ?? 0;
      return kbps > 0 ? kbps * 1000 : INITIAL_BANDWIDTH_BPS;
    },
    readBufferSec: () => player.getBufferLength?.("video") ?? 0,
    readSegmentSec: () => segmentSec,
    apply: (index) => {
      player.setRepresentationForTypeByIndex?.("video", index, true);
    },
    // forceReplace already abandons buffered and in-flight segments of the old rung.
    applyNow: (index) => {
      player.setRepresentationForTypeByIndex?.("video", index, true);
    },
  };

  return run(adapter, algorithm, targetBufferSec, options);
}

/**
 * Pins a player to its highest rung and leaves it there — the fixed-quality control condition,
 * not an adaptive algorithm.
 */
export function pinHighestHls(hls: Hls): void {
  if (hls.levels.length > 0) {
    hls.nextLevel = hls.levels.length - 1;
  }
}

export function pinHighestDash(player: DashPlayerLike): void {
  const list = player.getRepresentationsByType?.("video") ?? [];
  if (list.length === 0) {
    return;
  }

  const top = list.reduce((best, current) =>
    (current.bandwidth ?? 0) > (best.bandwidth ?? 0) ? current : best,
  );

  player.setRepresentationForTypeByIndex?.("video", top.index ?? list.length - 1, true);
}
