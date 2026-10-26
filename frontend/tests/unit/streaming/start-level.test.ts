import { describe, expect, it } from "vite-plus/test";

import {
  INITIAL_BANDWIDTH_BPS,
  START_BANDWIDTH_FRACTION,
  TARGET_BUFFER_SEC,
  VARIABLE_NETWORK_BUFFER_SEC,
  pickFastStartLevel,
  pickStartLevel,
  targetBufferFor,
} from "@/lib/streamingConfig";

const budget = INITIAL_BANDWIDTH_BPS * START_BANDWIDTH_FRACTION;
const bitrate = (level: { bps: number }) => level.bps;

describe("pickStartLevel", () => {
  it("opens on the highest rung that fits the opening estimate, whatever the input order", () => {
    const levels = [{ bps: 4_000_000 }, { bps: 600_000 }, { bps: 1_500_000 }, { bps: 250_000 }];
    expect(pickStartLevel(levels, bitrate)).toEqual({ bps: 1_500_000 });
  });

  it("takes a rung sitting exactly on the budget", () => {
    expect(pickStartLevel([{ bps: 100_000 }, { bps: budget }], bitrate)).toEqual({ bps: budget });
  });

  it("falls back to the lowest rung when none fits", () => {
    const levels = [{ bps: 5_000_000 }, { bps: 3_000_000 }];
    expect(pickStartLevel(levels, bitrate)).toEqual({ bps: 3_000_000 });
  });

  it("returns nothing for an empty ladder", () => {
    expect(pickStartLevel([], bitrate)).toBeUndefined();
  });
});

describe("pickFastStartLevel", () => {
  it("opens on the top rung", () => {
    const levels = [{ bps: 600_000 }, { bps: 7_800_000 }, { bps: 2_000_000 }];
    expect(pickFastStartLevel(levels, bitrate)).toEqual({ bps: 7_800_000 });
  });
});

describe("targetBufferFor", () => {
  it("shrinks the buffer only for the variable network, so the drop reaches the playhead", () => {
    expect(targetBufferFor("variable")).toBe(VARIABLE_NETWORK_BUFFER_SEC);
    expect(targetBufferFor("fourG")).toBe(TARGET_BUFFER_SEC);
    expect(targetBufferFor(null)).toBe(TARGET_BUFFER_SEC);
  });
});
