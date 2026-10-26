import { describe, expect, it } from "vite-plus/test";

import {
  formatBitrate,
  formatSigned,
  isLadderKind,
  ladderLabel,
  parseResolutionHeight,
} from "@/lib/analysisFormat";

describe("formatBitrate", () => {
  it("writes rates from 1 Mb/s up in Mb/s", () => {
    expect(formatBitrate(1_000_000)).toBe("1.00 Mb/s");
    expect(formatBitrate(7_800_000)).toBe("7.80 Mb/s");
  });

  it("shows a dash for values that were never measured", () => {
    expect(formatBitrate(null)).toBe("—");
    expect(formatBitrate(0)).toBe("—");
    expect(formatBitrate(Number.NaN)).toBe("—");
  });
});

describe("formatSigned", () => {
  it("keeps the sign on a delta and a dash for missing values", () => {
    expect(formatSigned(0.4249)).toBe("+0.42");
    expect(formatSigned(-8.1, 1)).toBe("-8.1");
    expect(formatSigned(0)).toBe("0.00");
    expect(formatSigned(undefined)).toBe("—");
  });
});

describe("parseResolutionHeight", () => {
  it("reads both separators and returns null instead of NaN", () => {
    expect(parseResolutionHeight("1920:1080")).toBe(1080);
    expect(parseResolutionHeight("1280x720")).toBe(720);
    expect(parseResolutionHeight("720p")).toBeNull();
    expect(parseResolutionHeight(null)).toBeNull();
  });
});

describe("ladder kinds", () => {
  it("knows exactly the three packaging runs and never labels a fourth as static", () => {
    expect(["static", "dynamic", "animation"].every(isLadderKind)).toBe(true);
    expect(isLadderKind("animationTuned")).toBe(false);
    expect(ladderLabel("dynamic")).toBe("Content-adaptive");
    expect(ladderLabel("animation")).toBe("Animation-optimised");
    expect(ladderLabel("mystery")).toBe("mystery");
  });
});
