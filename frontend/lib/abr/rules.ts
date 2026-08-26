/**
 * Adaptive bitrate decision rules, implemented once and driven from both hls.js and dash.js.
 *
 * The protocol comparison in the thesis only means something if the algorithm is held constant
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
}

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
 * Hybrid rule: the more cautious of the two.
 *
 * Taking the minimum means a rung has to be justified by measured throughput *and* by buffer
 * occupancy before it is selected, which is the combination the thesis describes as hybrid.
 */
export function hybridRule(state: AbrState): AbrDecision {
  const byThroughput = throughputRule(state);
  const byBuffer = bufferRule(state);
  const levels = sorted(state.levels);

  const rank = (index: number) => levels.findIndex((level) => level.index === index);
  const chosen = rank(byThroughput.index) <= rank(byBuffer.index) ? byThroughput : byBuffer;

  return {
    index: chosen.index,
    reason: `hybrid → ${chosen.reason}`,
  };
}

/**
 * Applies the safety net every rule shares. A buffer this close to empty means the next decision
 * arrives too late to matter, so the bottom rung is forced regardless of what the rule preferred.
 */
export function decide(
  algorithm: "throughput" | "buffer" | "hybrid",
  state: AbrState,
): AbrDecision {
  const levels = sorted(state.levels);
  if (levels.length === 0) {
    return { index: 0, reason: "no levels" };
  }

  if (state.bufferSec < PANIC_BUFFER_SEC && state.currentIndex !== levels[0].index) {
    return { index: levels[0].index, reason: `panic buffer ${state.bufferSec.toFixed(1)}s` };
  }

  const rule =
    algorithm === "throughput"
      ? throughputRule
      : algorithm === "buffer"
        ? bufferRule
        : hybridRule;

  // Every rule returns the index carried by a real level, so no clamping is needed — and clamping
  // by array position would be wrong anyway, since a player's level indices need not be positions.
  return rule(state);
}
