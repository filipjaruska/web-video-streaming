import { describe, expect, it } from "vite-plus/test";

import { formatMbpsTick, logDomain, logTicks } from "@/lib/chartScale";

describe("log bitrate axis", () => {
  it("pads the domain around the data and ignores non-positive values", () => {
    const [low, high] = logDomain([0, 0.2, 4]);
    expect(low).toBeCloseTo(0.2 / 1.15);
    expect(high).toBeCloseTo(4 * 1.15);
  });

  it("puts ticks on 1, 2 and 5 of each decade inside the domain", () => {
    expect(logTicks([0.15, 4.6])).toEqual([0.2, 0.5, 1, 2]);
    expect(logTicks([0.05, 12])).toEqual([0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]);
  });

  it("writes sub-megabit ticks with the digits they need", () => {
    expect(formatMbpsTick(0.05)).toBe("0.05");
    expect(formatMbpsTick(0.2)).toBe("0.2");
    expect(formatMbpsTick(2)).toBe("2");
  });
});
