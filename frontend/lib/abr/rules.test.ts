import { describe, expect, it } from "vitest";

import {
  type AbrLevel,
  type AbrState,
  bufferRule,
  decide,
  hybridRule,
  throughputRule,
} from "./rules";

/**
 * These assert the properties each rule is claimed to have rather than fixed outputs, so the
 * constants can be retuned without rewriting the suite. The buffer rule needs them most: BOLA's
 * score expression inverts its preference as the buffer crosses a threshold, and a sign error there
 * yields a rule that still runs and still switches, only backwards.
 */
const LADDER: AbrLevel[] = [
  { index: 0, bitrateBps: 400_000, height: 240 },
  { index: 1, bitrateBps: 800_000, height: 360 },
  { index: 2, bitrateBps: 1_200_000, height: 480 },
  { index: 3, bitrateBps: 2_500_000, height: 720 },
  { index: 4, bitrateBps: 4_500_000, height: 1080 },
];

function state(partial: Partial<AbrState> = {}): AbrState {
  return {
    levels: LADDER,
    currentIndex: 2,
    bandwidthBps: 3_000_000,
    bufferSec: 15,
    targetBufferSec: 30,
    segmentSec: 6,
    ...partial,
  };
}

describe("throughputRule", () => {
  it("picks the most expensive rung that fits the estimate", () => {
    expect(throughputRule(state({ bandwidthBps: 1_500_000, currentIndex: 0 })).index).toBe(2);
    expect(throughputRule(state({ bandwidthBps: 10_000_000 })).index).toBe(4);
  });

  it("floors at the bottom rung when nothing fits", () => {
    expect(throughputRule(state({ bandwidthBps: 300_000 })).index).toBe(0);
  });

  it("holds a rung it already occupies but will not climb into it at the same estimate", () => {
    // Asymmetric safety factors are what stop two neighbours oscillating on estimate jitter.
    expect(throughputRule(state({ bandwidthBps: 2_500_000, currentIndex: 3 })).index).toBe(3);
    expect(throughputRule(state({ bandwidthBps: 2_500_000, currentIndex: 2 })).index).toBe(2);
  });
});

describe("bufferRule", () => {
  const atBuffer = (sec: number) => bufferRule(state({ bufferSec: sec, bandwidthBps: 0 })).index;

  it("spans the ladder between an empty and a full buffer", () => {
    expect(atBuffer(0)).toBe(0);
    expect(atBuffer(30)).toBe(4);
  });

  it("never moves down as the buffer grows", () => {
    let previous = -1;
    for (let sec = 0; sec <= 30; sec += 0.5) {
      const index = atBuffer(sec);
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
  });

  it("ignores throughput entirely", () => {
    const starved = bufferRule(state({ bufferSec: 30, bandwidthBps: 0 })).index;
    const flooded = bufferRule(state({ bufferSec: 30, bandwidthBps: 50_000_000 })).index;
    expect(starved).toBe(flooded);
  });
});

describe("hybridRule", () => {
  it("never exceeds either component", () => {
    for (let sec = 0; sec <= 30; sec += 2) {
      for (const bandwidthBps of [300_000, 1_500_000, 3_000_000, 10_000_000]) {
        const s = state({ bufferSec: sec, bandwidthBps });
        expect(hybridRule(s).index).toBeLessThanOrEqual(throughputRule(s).index);
        expect(hybridRule(s).index).toBeLessThanOrEqual(bufferRule(s).index);
      }
    }
  });

  it("refuses a rung that only one component supports", () => {
    expect(hybridRule(state({ bufferSec: 1, bandwidthBps: 50_000_000, currentIndex: 0 })).index).toBe(0);
    expect(hybridRule(state({ bufferSec: 30, bandwidthBps: 200_000, currentIndex: 0 })).index).toBe(0);
  });
});

describe("decide", () => {
  it("forces the bottom rung when the buffer is nearly empty", () => {
    expect(decide("buffer", state({ bufferSec: 1, currentIndex: 4 })).index).toBe(0);
  });

  it("leaves a healthy buffer to the rule", () => {
    expect(decide("throughput", state({ bufferSec: 20, bandwidthBps: 10_000_000 })).index).toBe(4);
  });
});
