/**
 * Adaptive bitrate decision rules, implemented once and driven from both hls.js and dash.js.
 *
 * A comparison between protocols only means something if the algorithm is held constant
 * across it. Neither player allows that out of the box: hls.js ships a single ABR controller with
 * no throughput-only or buffer-only mode, while dash.js ships its own throughput and BOLA rules
 * whose internals differ from it. Selecting each player's built-ins under a shared label would
 * measure two different algorithms and attribute the difference to the protocol.
 *
 * These functions are therefore pure and player-agnostic: an adapter feeds them the ladder, the
 * throughput estimate and the buffer level, and applies the index they return.
 */

export interface AbrLevel {
  /** Index into the player's own level list. */
  index: number;
  bitrateBps: number;
  height: number;
}

export interface AbrState {
  /** Ascending by bitrate. */
  levels: AbrLevel[];
  currentIndex: number;
  /** Measured throughput estimate, bits per second. */
  bandwidthBps: number;
  /** Forward buffer, seconds. */
  bufferSec: number;
  /** Buffer the player is trying to keep, seconds. */
  targetBufferSec: number;
  segmentSec: number;
}

export interface AbrDecision {
  index: number;
  reason: string;
  /** The hybrid rule's memory after this decision; carried into the next one. */
  hybrid?: HybridMemory;
}

/**
 * What the hybrid rule remembers between decisions: which rule is in charge, and the virtual buffer
 * BOLA was handed when it took over.
 */
export interface HybridMemory {
  useBola: boolean;
  placeholderSec: number;
}

export const INITIAL_HYBRID_MEMORY: HybridMemory = { useBola: false, placeholderSec: 0 };

/**
 * Fraction of measured throughput a rung must fit inside to be selected. Below 1 so that an
 * estimate which is momentarily optimistic does not immediately cause a rebuffer.
 */
const THROUGHPUT_SAFETY = 0.9;

/**
 * Switching down is allowed at a slacker factor than switching up, so a stream sitting just under
 * its rung's requirement does not oscillate between two neighbours on small estimate jitter.
 */
const THROUGHPUT_DOWN_SAFETY = 1.0;

/** BOLA's gamma·p term, in the units of its utility function. Larger keeps the buffer fuller. */
const BOLA_GP = 5;

/** Below this the buffer is treated as an emergency regardless of what the rule computes. */
const PANIC_BUFFER_SEC = 4;

/**
 * Share of the target buffer at which the hybrid rule hands over to BOLA, and below which it takes
 * control back. Two thresholds, so a buffer hovering at one of them does not flip the rule on every
 * segment.
 */
const HYBRID_BOLA_ON_FRACTION = 0.5;
const HYBRID_BOLA_OFF_FRACTION = 0.25;

/** Step of the buffer scan that sizes the placeholder, seconds. */
const PLACEHOLDER_SCAN_STEP_SEC = 0.25;

function sorted(levels: AbrLevel[]): AbrLevel[] {
  return [...levels].sort((a, b) => a.bitrateBps - b.bitrateBps);
}

/**
 * Pure throughput rule: the most expensive rung that fits inside the measured throughput.
 *
 * Asymmetric safety factors give the hysteresis. A rung must fit inside 90% of the estimate to be
 * switched up to, but is only abandoned once it no longer fits inside 100% of it, so the two
 * thresholds differ and a stream parked between them stays where it is.
 */
export function throughputRule(state: AbrState): AbrDecision {
  const levels = sorted(state.levels);
  if (levels.length === 0) {
    return { index: 0, reason: "no levels" };
  }

  const current = levels.find((level) => level.index === state.currentIndex) ?? levels[0];
  const goingUp = (candidate: AbrLevel) => candidate.bitrateBps > current.bitrateBps;

  let chosen = levels[0];
  for (const level of levels) {
    const safety = goingUp(level) ? THROUGHPUT_SAFETY : THROUGHPUT_DOWN_SAFETY;
    if (level.bitrateBps <= state.bandwidthBps * safety) {
      chosen = level;
    }
  }

  return {
    index: chosen.index,
    reason: `throughput ${(state.bandwidthBps / 1000).toFixed(0)} kb/s`,
  };
}

/**
 * Buffer rule, following BOLA-BASIC.
 *
 * Each rung scores `(V·(u_i + gp) − Q) / S_i`, where `u_i = ln(b_i / b_0)` is its utility, `S_i` is
 * its segment size and `Q` is the current buffer. The shape of that expression is what produces
 * BOLA's behaviour without any throughput estimate at all: while the buffer is small the numerator
 * is positive and dividing by segment size favours the cheap rungs, and once the buffer grows past
 * it the numerator turns negative, where a larger segment size is *less* penalised and the
 * expensive rungs win. `V` is set so the extremes line up with an empty and a full buffer.
 */
export function bufferRule(state: AbrState): AbrDecision {
  const levels = sorted(state.levels);
  if (levels.length === 0) {
    return { index: 0, reason: "no levels" };
  }

  if (levels.length === 1) {
    return { index: levels[0].index, reason: "single level" };
  }

  const base = levels[0].bitrateBps;
  const utility = (level: AbrLevel) => Math.log(level.bitrateBps / base);
  const maxUtility = utility(levels[levels.length - 1]);

  // Anchors the rule to the ladder in hand: an empty buffer lands on the bottom rung and a full
  // one on the top, whatever the ladder's actual spread of bitrates happens to be.
  const v =
    (Math.max(state.targetBufferSec, state.segmentSec * 2) - state.segmentSec) /
    (maxUtility + BOLA_GP);

  let best = levels[0];
  let bestScore = -Infinity;

  for (const level of levels) {
    const size = state.segmentSec * (level.bitrateBps / base);
    const score = (v * (utility(level) + BOLA_GP) - state.bufferSec) / size;
    if (score > bestScore) {
      bestScore = score;
      best = level;
    }
  }

  return {
    index: best.index,
    reason: `bola buffer ${state.bufferSec.toFixed(1)}s`,
  };
}

/**
 * The smallest buffer at which BOLA would choose at least the given rung, seconds.
 */
function bufferForRung(state: AbrState, index: number): number {
  const levels = sorted(state.levels);
  const rank = (candidate: number) => levels.findIndex((level) => level.index === candidate);
  const wanted = rank(index);
  const limit = Math.max(state.targetBufferSec, state.segmentSec * 2);

  for (let sec = 0; sec <= limit; sec += PLACEHOLDER_SCAN_STEP_SEC) {
    if (rank(bufferRule({ ...state, bufferSec: sec }).index) >= wanted) {
      return sec;
    }
  }

  return limit;
}

/**
 * Hybrid rule: throughput while the buffer is short, BOLA once it is healthy — the arrangement of
 * dash.js's DYNAMIC rule.
 *
 * Each rule is used where it is strong. With little buffer (startup, after a stall) there is
 * nothing for BOLA to go on — it would open on the bottom rung — while a throughput estimate already
 * says what the link carries. With a healthy buffer, BOLA's buffer-driven choice is steadier than
 * an estimate that jitters from segment to segment.
 *
 * When BOLA takes over it is handed a placeholder buffer: the extra seconds it would need to choose
 * the rung throughput had reached. Without it BOLA would read the half-full buffer as a reason to
 * step down straight away. The placeholder is dropped when throughput takes control back, and the
 * effective buffer never exceeds the target, so BOLA cannot be pushed past its own top.
 */
export function hybridRule(
  state: AbrState,
  memory: HybridMemory = INITIAL_HYBRID_MEMORY,
): AbrDecision {
  const byThroughput = throughputRule(state);
  let { useBola, placeholderSec } = memory;

  if (useBola && state.bufferSec < state.targetBufferSec * HYBRID_BOLA_OFF_FRACTION) {
    useBola = false;
    placeholderSec = 0;
  } else if (!useBola && state.bufferSec >= state.targetBufferSec * HYBRID_BOLA_ON_FRACTION) {
    useBola = true;
    placeholderSec = Math.max(0, bufferForRung(state, byThroughput.index) - state.bufferSec);
  }

  if (!useBola) {
    return {
      index: byThroughput.index,
      reason: `hybrid → ${byThroughput.reason}`,
      hybrid: { useBola, placeholderSec },
    };
  }

  const effectiveSec = Math.min(state.bufferSec + placeholderSec, state.targetBufferSec);
  const byBuffer = bufferRule({ ...state, bufferSec: effectiveSec });
  return {
    index: byBuffer.index,
    reason: `hybrid → ${byBuffer.reason}`,
    hybrid: { useBola, placeholderSec },
  };
}

/**
 * Applies the safety net every rule shares. A buffer this close to empty means the next decision
 * arrives too late to matter, so the bottom rung is forced regardless of what the rule preferred.
 */
export function decide(
  algorithm: "throughput" | "buffer" | "hybrid",
  state: AbrState,
  hybridMemory: HybridMemory = INITIAL_HYBRID_MEMORY,
): AbrDecision {
  const levels = sorted(state.levels);
  if (levels.length === 0) {
    return { index: 0, reason: "no levels" };
  }

  if (state.bufferSec < PANIC_BUFFER_SEC && state.currentIndex !== levels[0].index) {
    // An emergency also hands the hybrid rule back to throughput: the buffer it relied on is gone.
    return {
      index: levels[0].index,
      reason: `panic buffer ${state.bufferSec.toFixed(1)}s`,
      hybrid: algorithm === "hybrid" ? INITIAL_HYBRID_MEMORY : undefined,
    };
  }

  // Every rule returns the index carried by a real level, so no clamping is needed — and clamping
  // by array position would be wrong anyway, since a player's level indices need not be positions.
  if (algorithm === "throughput") {
    return throughputRule(state);
  }

  if (algorithm === "buffer") {
    return bufferRule(state);
  }

  return hybridRule(state, hybridMemory);
}
