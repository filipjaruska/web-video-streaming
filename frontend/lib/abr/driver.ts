import type Hls from "hls.js";
import type { AbrController } from "hls.js";
import {
  FAST_START_TIMEOUT_MS,
  INITIAL_BANDWIDTH_BPS,
  SEGMENT_SEC,
  pickFastStartLevel,
  pickStartLevel,
} from "@/lib/streamingConfig";
import { type AbrLevel, type AbrState, decide } from "./rules";

export type AbrRuleName = "throughput" | "buffer" | "hybrid";

/**
 * Backstop cadence for DASH decisions, milliseconds.
 *
 * Every segment's rung is decided from the state at its own request — on HLS by hls.js asking the
 * controller from {@link createRuleAbrController}, on DASH whenever a segment has been appended — so
 * the clock only keeps DASH's choice current while nothing is being fetched. Deciding on the clock
 * alone made the outcome depend on where its ticks fell: on a fast link hls.js fetched most of a
 * 30 s clip at the opening rung between two ticks, and three runs of one unshaped configuration
 * (HLS · hybrid) spread by ±10 points of delivered VMAF.
 */
const TICK_MS = 1000;

/**
 * How close to the end of the media the buffer must reach to count as holding the rest of the clip,
 * seconds. Covers the tail segment's rounding and small gaps between appended ranges.
 */
const END_OF_MEDIA_TOLERANCE_SEC = 0.5;

/**
 * Share of one segment that must be buffered before the opening rung hands over to the rules. Just
 * under a whole segment, because a buffered range can end a few milliseconds short of its edge.
 */
const STARTUP_BUFFERED_FRACTION = 0.9;

/**
 * dash.js's event for a segment fully appended to the buffer.
 *
 * Internal to dash.js (5.2) rather than part of its public event list, but the only per-segment
 * signal there is: the public bufferLevelUpdated also fires on every playback progression. It is
 * raised after the buffer level and the throughput of the segment are known and before the next
 * request, which dash.js schedules on a zero-delay timer, so a decision taken in it governs that
 * request.
 */
const DASH_SEGMENT_APPENDED = "bytesAppendedEndFragment";

export interface AbrDriver {
  stop(): void;
}

export interface DriverOptions {
  /**
   * Best mode's fast start. Opens on the top rung instead of the fixed start rung and drops
   * straight to the bottom one if its first segment has not arrived within `FAST_START_TIMEOUT_MS`.
   * Never set for a measured profile — see `pickFastStartLevel`.
   */
  fastStart?: boolean;
}

/** The state a rule needs, read out of one player. */
interface StateReader {
  readLevels(): AbrLevel[];
  /** The rung the next request would use if nothing changed. */
  readCurrentIndex(): number;
  readBandwidthBps(): number;
  readBufferSec(): number;
  readSegmentSec(): number;
  /** Media time left to play, seconds; Infinity while the duration is unknown. */
  readRemainingSec(): number;
}

interface Decision {
  index: number;
  /** Abandon what is in flight — only when fast start gives up on its opening segment. */
  immediate: boolean;
}

interface Decider {
  /** The rung for the very first request. */
  opening(): number | null;
  /** The rung for the next request. */
  next(): Decision | null;
}

/**
 * The decision both protocols share: the rules from `rules.ts`, plus when they do not apply.
 *
 * The opening rung is held until its first segment is buffered. Before that there is no measurement
 * to decide on — no throughput sample, and an empty buffer that is expected rather than an
 * emergency. Letting the rules run on it used to fire the panic rule on every start, so each
 * measured run opened on the bottom rung whatever start rung had been chosen.
 */
function createDecider(
  reader: StateReader,
  algorithm: AbrRuleName,
  targetBufferSec: number,
  options: DriverOptions,
): Decider {
  let startedAt: number | null = null;
  let opening = true;

  return {
    opening() {
      startedAt ??= performance.now();
      const levels = reader.readLevels();
      const pick = options.fastStart
        ? pickFastStartLevel(levels, (level) => level.bitrateBps)
        : pickStartLevel(levels, (level) => level.bitrateBps);
      return pick?.index ?? null;
    },

    next() {
      startedAt ??= performance.now();
      const levels = reader.readLevels();
      if (levels.length === 0) {
        return null;
      }

      const state: AbrState = {
        levels,
        currentIndex: reader.readCurrentIndex(),
        bandwidthBps: reader.readBandwidthBps(),
        bufferSec: reader.readBufferSec(),
        targetBufferSec,
        segmentSec: reader.readSegmentSec(),
      };
      const hold: Decision = { index: state.currentIndex, immediate: false };

      if (opening) {
        if (state.bufferSec >= state.segmentSec * STARTUP_BUFFERED_FRACTION) {
          opening = false;
        } else if (options.fastStart && performance.now() - startedAt >= FAST_START_TIMEOUT_MS) {
          opening = false;
          const lowest = levels.reduce((low, level) => (level.bitrateBps < low.bitrateBps ? level : low));
          return { index: lowest.index, immediate: lowest.index !== state.currentIndex };
        } else {
          return hold;
        }
      }

      // After a fast start the opening segment is the only measurement there is; until the player
      // reports an estimate from it, holding the rung beats reading "no estimate" as zero throughput.
      if (options.fastStart && !(state.bandwidthBps > 0)) {
        return hold;
      }

      // The rest of the clip is already buffered, so no request remains for a decision to govern.
      // Deciding anyway read the draining tail as an emergency: the panic rule fired in every clip's
      // last seconds and dropped to the bottom rung for nothing, which the measurement then counted
      // as switches — and on DASH, while switches still replaced the buffer, froze the picture.
      if (state.bufferSec >= reader.readRemainingSec() - END_OF_MEDIA_TOLERANCE_SEC) {
        return hold;
      }

      return { index: decide(algorithm, state).index, immediate: false };
    },
  };
}

/**
 * How far ahead of the playhead a buffered range may start and still count as the one it plays
 * from, seconds. Before playback begins the playhead sits at 0 while the first frame is a fraction of
 * a second in — the composition offset of the B-frames — until hls.js moves the playhead onto it.
 */
const BUFFER_HOLE_TOLERANCE_SEC = 0.5;

/** Forward buffer ahead of the playhead, in seconds. */
function bufferAhead(media: HTMLMediaElement | null | undefined): number {
  if (!media) {
    return 0;
  }

  const { buffered, currentTime } = media;
  for (let i = 0; i < buffered.length; i++) {
    // Without the tolerance the whole buffer read as empty until playback started: the opening rung
    // was held while hls.js fetched the entire clip back to back, and the run never left it.
    if (currentTime >= buffered.start(i) - BUFFER_HOLE_TOLERANCE_SEC && currentTime <= buffered.end(i)) {
      return buffered.end(i) - currentTime;
    }
  }

  return 0;
}

function hlsReader(hls: Hls): StateReader {
  return {
    readLevels: () =>
      hls.levels.map((level, index) => ({
        index,
        bitrateBps: level.bitrate,
        height: level.height ?? 0,
      })),
    // loadLevel is the rung of the fragment last selected, which the next one keeps unless changed.
    readCurrentIndex: () => (hls.loadLevel >= 0 ? hls.loadLevel : (hls.currentLevel ?? 0)),
    readBandwidthBps: () => hls.bandwidthEstimate,
    readBufferSec: () => bufferAhead(hls.media),
    // The packaging segment length, as on DASH. hls.js would report TARGETDURATION, the rounded-up
    // longest segment — 7 on ladders packaged before keyframes were forced — so reading it here
    // handed the buffer rule a different figure on each protocol for the same segments.
    readSegmentSec: () => SEGMENT_SEC,
    readRemainingSec: () => {
      const media = hls.media;
      return media && Number.isFinite(media.duration) ? media.duration - media.currentTime : Infinity;
    },
  };
}

/**
 * hls.js's ABR controller with the choice of level handed to the shared rules. Passed to hls.js as
 * its `abrController`; the fixed-quality control keeps the stock one and pins a level instead.
 *
 * hls.js asks its controller for a level each time it picks the next fragment — after the previous
 * one is buffered and its download folded into the bandwidth estimate, and before the request goes
 * out. That is the only point at which a rule sees the state its decision acts on. Setting a level
 * from outside cannot reach it: hls.js requests the next fragment synchronously inside its own
 * FRAG_BUFFERED handler, before listeners added later run, and only updates the estimate there, so
 * a decision taken on BUFFER_APPENDED still saw the previous estimate and HLS switched one segment
 * later than DASH. Answering here also switches the way DASH now does — from the next fragment,
 * nothing buffered replaced — where `hls.nextLevel`, used before, flushed the buffer past the next
 * fragment on every switch.
 *
 * Everything else of the stock controller is kept, above all the bandwidth estimator the throughput
 * rule reads, except the rule that abandons a slow fragment and drops a level on hls.js's own
 * judgement: it would be a fourth algorithm acting alongside the one being measured.
 */
export function createRuleAbrController(
  Base: typeof AbrController,
  algorithm: AbrRuleName,
  targetBufferSec: number,
  options: DriverOptions = {},
): typeof AbrController {
  return class RuleAbrController extends Base {
    decider: Decider;
    fastStartTimer = 0;

    constructor(hls: Hls) {
      super(hls);
      (this as unknown as { _abandonRulesCheck: () => void })._abandonRulesCheck = () => {};
      this.decider = createDecider(hlsReader(hls), algorithm, targetBufferSec, options);
    }

    /** Read by hls.js once, as loading starts, for the first fragment. */
    get firstAutoLevel(): number {
      if (options.fastStart && this.fastStartTimer === 0) {
        // hls.js asks for a level only between fragments, so an opening fragment that never
        // arrives has to be noticed by a timer and abandoned for the bottom rung from outside.
        this.fastStartTimer = window.setTimeout(() => {
          const decision = this.decider.next();
          if (decision?.immediate) {
            this.hls.currentLevel = decision.index;
            // Back to automatic selection, which is this controller; currentLevel pins manually.
            this.hls.loadLevel = -1;
          }
        }, FAST_START_TIMEOUT_MS);
      }

      return this.decider.opening() ?? (Reflect.get(Base.prototype, "firstAutoLevel", this) as number);
    }

    get nextAutoLevel(): number {
      return this.decider.next()?.index ?? (Reflect.get(Base.prototype, "nextAutoLevel", this) as number);
    }

    set nextAutoLevel(level: number) {
      Reflect.set(Base.prototype, "nextAutoLevel", level, this);
    }

    destroy(): void {
      window.clearTimeout(this.fastStartTimer);
      super.destroy();
    }
  };
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
  duration?: () => number;
  time?: () => number;
  on?: (type: string, listener: (event: { mediaType?: string }) => void) => void;
  off?: (type: string, listener: (event: { mediaType?: string }) => void) => void;
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

  const reader: StateReader = {
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
    readRemainingSec: () => {
      try {
        const duration = player.duration?.();
        const time = player.time?.();
        return typeof duration === "number" && Number.isFinite(duration) && typeof time === "number"
          ? duration - time
          : Infinity;
      } catch {
        // dash.js throws from these before a source is attached.
        return Infinity;
      }
    },
  };

  const decider = createDecider(reader, algorithm, targetBufferSec, options);

  const tick = () => {
    const decision = decider.next();
    if (!decision || decision.index === reader.readCurrentIndex()) {
      return;
    }

    // From the next segment, as on HLS. This used to force-replace the buffer on every decision:
    // dash.js dropped the video buffered ahead of the playhead and fetched it again, and while the
    // decoder ran dry Chrome let audio and the clock run on over a frozen picture — DASH looked
    // stall-free in the numbers while visibly freezing. Forced only when fast start gives up on its
    // opening segment, before there is anything worth keeping.
    player.setRepresentationForTypeByIndex?.("video", decision.index, decision.immediate);
  };

  // Deferred to a microtask: that still precedes the next request, which dash.js schedules on a
  // zero-delay timer, but no longer runs inside dash.js's own dispatch of the event, where a switch
  // requested re-entrantly — or an exception — could keep its later handlers from finishing the
  // append. One DASH run stalled at the end of the clip without ever signalling end of stream.
  const onAppended = (event: { mediaType?: string }) => {
    if (event.mediaType !== "video") {
      return;
    }

    queueMicrotask(() => {
      try {
        tick();
      } catch {
        // A decision missed here is taken on the next append or clock tick.
      }
    });
  };

  const handle = window.setInterval(tick, TICK_MS);
  player.on?.(DASH_SEGMENT_APPENDED, onAppended);
  tick();

  return {
    stop() {
      window.clearInterval(handle);
      player.off?.(DASH_SEGMENT_APPENDED, onAppended);
    },
  };
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
