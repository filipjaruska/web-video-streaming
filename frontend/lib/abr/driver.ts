import type Hls from "hls.js";
import { SEGMENT_SEC } from "@/lib/streamingConfig";
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

export interface AbrDriver {
  stop(): void;
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
}

function run(adapter: PlayerAdapter, algorithm: AbrRuleName, targetBufferSec: number): AbrDriver {
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
  };

  return run(adapter, algorithm, targetBufferSec);
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
    // dash.js reports throughput in kbps; the rules work in bits per second throughout.
    readBandwidthBps: () => (player.getAverageThroughput?.("video") ?? 0) * 1000,
    readBufferSec: () => player.getBufferLength?.("video") ?? 0,
    readSegmentSec: () => segmentSec,
    apply: (index) => {
      player.setRepresentationForTypeByIndex?.("video", index, true);
    },
  };

  return run(adapter, algorithm, targetBufferSec);
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
