import type { BenchmarkEvent, BenchmarkMetrics, BenchmarkSample, BenchmarkTrace } from "./types";

/**
 * Derives every metric chapter 4.4 reports from one playback trace.
 *
 * Pure and player-agnostic on purpose. These definitions are quoted in the thesis and decide whether
 * a difference between two configurations is real, so they are fixed in one place and tested against
 * hand-computed traces rather than being spread across the collection code.
 */

/**
 * Samples a rung must hold before recovery counts as achieved.
 *
 * Without a dwell requirement a single optimistic switch back — immediately abandoned — would be
 * recorded as a full recovery, which flatters exactly the oscillating behaviour the measurement is
 * meant to expose.
 */
const RECOVERY_DWELL_SAMPLES = 3;

function firstEvent<K extends BenchmarkEvent["kind"]>(
  events: BenchmarkEvent[],
  kind: K,
): Extract<BenchmarkEvent, { kind: K }> | undefined {
  return events.find((event) => event.kind === kind) as
    | Extract<BenchmarkEvent, { kind: K }>
    | undefined;
}

/**
 * Total stalled time after the first frame, and how many stalls made it up.
 *
 * Anything before the startup event is the initial buffering, which is already reported as startup
 * time; counting it again here would charge one delay to two metrics.
 */
function measureRebuffering(
  events: BenchmarkEvent[],
  startupMs: number,
  durationMs: number,
): { count: number; totalMs: number } {
  let count = 0;
  let totalMs = 0;
  let openedAt: number | null = null;

  for (const event of events) {
    if (event.kind === "rebufferStart" && openedAt === null) {
      openedAt = event.atMs;
      continue;
    }

    if (event.kind === "rebufferEnd" && openedAt !== null) {
      const start = Math.max(openedAt, startupMs);
      if (event.atMs > start) {
        count++;
        totalMs += event.atMs - start;
      }

      openedAt = null;
    }
  }

  // A stall still open when the run ended is real and must be charged to the run, otherwise a
  // configuration that stalls permanently would score a perfect buffering ratio.
  if (openedAt !== null) {
    const start = Math.max(openedAt, startupMs);
    if (durationMs > start) {
      count++;
      totalMs += durationMs - start;
    }
  }

  return { count, totalMs };
}

/** Rung indices in sample order, restricted to playback and to samples that reported a rung. */
function rungSeries(samples: BenchmarkSample[], startupMs: number): number[] {
  return samples
    .filter((sample) => sample.atMs >= startupMs && sample.rungIndex >= 0)
    .map((sample) => sample.rungIndex);
}

/** Every change in rung, as +1 for a step up and -1 for a step down. */
function switchDirections(rungs: number[]): number[] {
  const directions: number[] = [];

  for (let i = 1; i < rungs.length; i++) {
    if (rungs[i] !== rungs[i - 1]) {
      directions.push(rungs[i] > rungs[i - 1] ? 1 : -1);
    }
  }

  return directions;
}

/**
 * Mean bitrate weighted by how long each rung was actually held.
 *
 * An unweighted mean over samples would let a rung that lasted one second count as much as one that
 * lasted a minute, which is not what "the quality the viewer got" means.
 */
function timeWeightedBitrate(samples: BenchmarkSample[], durationMs: number): number {
  let weighted = 0;
  let total = 0;

  for (let i = 0; i < samples.length; i++) {
    const until = i + 1 < samples.length ? samples[i + 1].atMs : durationMs;
    const dt = until - samples[i].atMs;
    if (dt <= 0) {
      continue;
    }

    weighted += samples[i].bitrateBps * dt;
    total += dt;
  }

  return total > 0 ? weighted / total : 0;
}

/**
 * Time from the first marked network change to sustained recovery of the pre-change rung.
 *
 * Returns null when nothing was marked, and also when quality never actually fell after the change —
 * there is no recovery to time if nothing was lost, and reporting zero there would be indistinguishable
 * from an instant recovery.
 */
function measureRecovery(samples: BenchmarkSample[], events: BenchmarkEvent[]): number | null {
  const transition = firstEvent(events, "networkTransition");
  if (!transition) {
    return null;
  }

  const before = samples.filter((sample) => sample.atMs < transition.atMs && sample.rungIndex >= 0);
  const after = samples.filter((sample) => sample.atMs >= transition.atMs && sample.rungIndex >= 0);
  if (before.length === 0 || after.length === 0) {
    return null;
  }

  const baseline = before[before.length - 1].rungIndex;
  const dropAt = after.findIndex((sample) => sample.rungIndex < baseline);
  if (dropAt < 0) {
    return null;
  }

  for (let i = dropAt; i <= after.length - RECOVERY_DWELL_SAMPLES; i++) {
    const held = after
      .slice(i, i + RECOVERY_DWELL_SAMPLES)
      .every((sample) => sample.rungIndex >= baseline);

    if (held) {
      return after[i].atMs - transition.atMs;
    }
  }

  return null;
}

export function computeMetrics(trace: BenchmarkTrace): BenchmarkMetrics {
  const { samples, events, durationMs } = trace;
  const startup = firstEvent(events, "startup");
  const startupMs = startup?.atMs ?? null;

  const empty: BenchmarkMetrics = {
    startupMs,
    rebufferCount: 0,
    rebufferMs: 0,
    bufferingRatio: 0,
    qualitySwitches: 0,
    oscillations: 0,
    timeWeightedBitrateBps: 0,
    droppedFrameRatio: 0,
    recoveryMs: null,
  };

  // Nothing ever rendered, so there is no playback to describe. Startup stays null rather than
  // being reported as zero, which would read as instantaneous rather than as never.
  if (startupMs === null) {
    return empty;
  }

  const rebuffering = measureRebuffering(events, startupMs, durationMs);
  const playingWindowMs = Math.max(0, durationMs - startupMs);
  const rungs = rungSeries(samples, startupMs);
  const directions = switchDirections(rungs);

  let oscillations = 0;
  for (let i = 1; i < directions.length; i++) {
    if (directions[i] !== directions[i - 1]) {
      oscillations++;
    }
  }

  const last = samples[samples.length - 1];

  return {
    startupMs,
    rebufferCount: rebuffering.count,
    rebufferMs: rebuffering.totalMs,
    bufferingRatio: playingWindowMs > 0 ? rebuffering.totalMs / playingWindowMs : 0,
    qualitySwitches: directions.length,
    oscillations,
    timeWeightedBitrateBps: timeWeightedBitrate(samples, durationMs),
    droppedFrameRatio: last && last.totalFrames > 0 ? last.droppedFrames / last.totalFrames : 0,
    recoveryMs: measureRecovery(samples, events),
  };
}

/**
 * Mean and sample standard deviation, which is what the chapter 5 tables print per cell.
 *
 * Sample (n−1) rather than population (÷n) because repetitions of a cell are a sample of the runs
 * that could have happened. SI/TI in `feature/analysis/siti-chart.tsx` uses the population form for
 * the opposite reason — it covers every frame of the clip. The two are meant to differ.
 */
export function summarize(values: number[]): { mean: number; stdDev: number } {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) {
    return { mean: 0, stdDev: 0 };
  }

  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  if (usable.length < 2) {
    return { mean, stdDev: 0 };
  }

  // Sample standard deviation (n−1): these repetitions are a sample of possible runs, not the
  // entire population of them.
  const variance =
    usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (usable.length - 1);

  return { mean, stdDev: Math.sqrt(variance) };
}
