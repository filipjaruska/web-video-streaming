import { describe, expect, it } from "vitest";

import { computeMetrics, summarize } from "./metrics";
import type { BenchmarkEvent, BenchmarkSample, BenchmarkTrace } from "./types";

/**
 * Traces here are hand-built so every expected value can be computed on paper. The definitions these
 * assert end up quoted in the thesis, and a wrong one produces numbers that look entirely plausible —
 * so the properties are pinned rather than the implementation.
 */
function sample(atMs: number, rungIndex: number, bitrateBps = 1_000_000): BenchmarkSample {
  return {
    atMs,
    playbackSec: atMs / 1000,
    bufferSec: 10,
    bandwidthBps: 5_000_000,
    bitrateBps,
    rungIndex,
    droppedFrames: 0,
    totalFrames: 100,
  };
}

function trace(
  samples: BenchmarkSample[],
  events: BenchmarkEvent[],
  durationMs: number,
): BenchmarkTrace {
  return { samples, events, durationMs };
}

const started: BenchmarkEvent = { kind: "startup", atMs: 1000 };

describe("startup", () => {
  it("reports the time to first frame", () => {
    const result = computeMetrics(trace([sample(1000, 2)], [started], 5000));
    expect(result.startupMs).toBe(1000);
  });

  it("reports null, not zero, when playback never began", () => {
    // Zero would read as an instantaneous start rather than as a run that never rendered.
    const result = computeMetrics(trace([], [], 5000));
    expect(result.startupMs).toBeNull();
    expect(result.bufferingRatio).toBe(0);
  });
});

describe("rebuffering", () => {
  it("excludes the initial buffering, which is already the startup time", () => {
    // A stall from 0-1000 ms is the startup; only the 2000-3000 ms stall is a rebuffer.
    const events: BenchmarkEvent[] = [
      { kind: "rebufferStart", atMs: 0 },
      { kind: "rebufferEnd", atMs: 1000 },
      started,
      { kind: "rebufferStart", atMs: 2000 },
      { kind: "rebufferEnd", atMs: 3000 },
    ];

    const result = computeMetrics(trace([sample(1000, 2)], events, 11_000));
    expect(result.rebufferCount).toBe(1);
    expect(result.rebufferMs).toBe(1000);
  });

  it("computes the ratio against time since the first frame", () => {
    // 2000 ms stalled out of the 10 000 ms that followed the first frame.
    const events: BenchmarkEvent[] = [
      started,
      { kind: "rebufferStart", atMs: 3000 },
      { kind: "rebufferEnd", atMs: 5000 },
    ];

    const result = computeMetrics(trace([sample(1000, 2)], events, 11_000));
    expect(result.bufferingRatio).toBeCloseTo(0.2, 6);
  });

  it("charges a stall that never ended before the run did", () => {
    const events: BenchmarkEvent[] = [started, { kind: "rebufferStart", atMs: 6000 }];

    const result = computeMetrics(trace([sample(1000, 2)], events, 11_000));
    expect(result.rebufferCount).toBe(1);
    expect(result.rebufferMs).toBe(5000);
  });
});

describe("switches and oscillations", () => {
  const run = (rungs: number[]) =>
    computeMetrics(
      trace(
        rungs.map((rung, index) => sample(1000 + index * 1000, rung)),
        [started],
        1000 + rungs.length * 1000,
      ),
    );

  it("counts every change as a switch", () => {
    expect(run([0, 1, 2, 3]).qualitySwitches).toBe(3);
    expect(run([2, 2, 2]).qualitySwitches).toBe(0);
  });

  it("does not treat a monotone climb as oscillation", () => {
    expect(run([0, 1, 2, 3, 4]).oscillations).toBe(0);
    expect(run([4, 3, 2, 1]).oscillations).toBe(0);
  });

  it("counts direction reversals", () => {
    // up, down, up → two reversals across three switches.
    expect(run([1, 2, 1, 2]).oscillations).toBe(2);
    // one reversal: climbs, then settles downward.
    expect(run([0, 1, 2, 1, 0]).oscillations).toBe(1);
  });
});

describe("time-weighted bitrate", () => {
  it("weights each rung by how long it was held", () => {
    // 1 Mb/s for 1 s then 5 Mb/s for 9 s → (1·1 + 5·9)/10 = 4.6 Mb/s.
    const samples = [sample(0, 0, 1_000_000), sample(1000, 4, 5_000_000)];
    const result = computeMetrics(trace(samples, [{ kind: "startup", atMs: 0 }], 10_000));
    expect(result.timeWeightedBitrateBps).toBeCloseTo(4_600_000, 0);
  });

  it("differs from an unweighted mean when dwell times differ", () => {
    const samples = [sample(0, 0, 1_000_000), sample(9000, 4, 5_000_000)];
    const result = computeMetrics(trace(samples, [{ kind: "startup", atMs: 0 }], 10_000));
    // Unweighted would be 3 Mb/s; weighted is (1·9 + 5·1)/10 = 1.4.
    expect(result.timeWeightedBitrateBps).toBeCloseTo(1_400_000, 0);
  });
});

describe("recovery", () => {
  const withTransition = (rungsAfter: number[]) => {
    const before = [sample(0, 4), sample(1000, 4)];
    const after = rungsAfter.map((rung, index) => sample(2000 + index * 1000, rung));
    const events: BenchmarkEvent[] = [
      { kind: "startup", atMs: 0 },
      { kind: "networkTransition", atMs: 2000, profile: "threeG" },
    ];
    return computeMetrics(
      trace([...before, ...after], events, 2000 + rungsAfter.length * 1000),
    );
  };

  it("times a drop followed by a sustained return", () => {
    // Transition at 2000; drops immediately, back to rung 4 at 5000 and held for three samples.
    // Recovery is measured from the transition, so 5000 − 2000.
    expect(withTransition([1, 1, 1, 4, 4, 4]).recoveryMs).toBe(3000);
  });

  it("ignores a single-sample blip back to the old rung", () => {
    // Touches 4 at 5000 then falls straight back, so recovery is not credited there; the sustained
    // return begins at 7000, giving 7000 − 2000.
    expect(withTransition([1, 1, 1, 4, 1, 4, 4, 4]).recoveryMs).toBe(5000);
  });

  it("reports null when quality never dropped", () => {
    // Nothing was lost, so there is nothing to recover from — distinct from recovering instantly.
    expect(withTransition([4, 4, 4, 4]).recoveryMs).toBeNull();
  });

  it("reports null when no transition was marked", () => {
    const result = computeMetrics(trace([sample(0, 4)], [{ kind: "startup", atMs: 0 }], 5000));
    expect(result.recoveryMs).toBeNull();
  });
});

describe("summarize", () => {
  it("returns the mean and sample standard deviation", () => {
    const { mean, stdDev } = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(mean).toBeCloseTo(5, 6);
    // Sample (n−1) standard deviation of that set is √(32/7).
    expect(stdDev).toBeCloseTo(Math.sqrt(32 / 7), 6);
  });

  it("reports zero spread for a single run", () => {
    expect(summarize([42])).toEqual({ mean: 42, stdDev: 0 });
  });
});
