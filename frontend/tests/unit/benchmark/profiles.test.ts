import { describe, expect, it } from "vite-plus/test";

import {
  NETWORK_PROFILE_RATE_BPS,
  THROUGHPUT_MISMATCH_FACTOR,
  exceedsProfileRate,
  fromServerProfile,
  toServerProfile,
  type NetworkProfile,
} from "@/lib/benchmark/types";
import { profileOf } from "@/lib/videoBenchmarksApi";

const profiles: NetworkProfile[] = ["standard", "fourG", "threeG", "variable"];

describe("server profile names", () => {
  it("uses the backend's C# enum names", () => {
    expect(profiles.map(toServerProfile)).toEqual(["Standard", "FourG", "ThreeG", "Variable"]);
  });

  it("round-trips every profile", () => {
    for (const profile of profiles) {
      expect(fromServerProfile(toServerProfile(profile))).toBe(profile);
    }
  });

  it("matches case-insensitively and falls back to standard for unknown names", () => {
    expect(fromServerProfile("threeg")).toBe("threeG");
    expect(fromServerProfile("FiveG")).toBe("standard");
    expect(profileOf({ networkProfile: "FourG" })).toBe("fourG");
  });
});

describe("exceedsProfileRate", () => {
  it("flags a throughput too far above the shaped rate to be that network", () => {
    const cap = NETWORK_PROFILE_RATE_BPS.threeG as number;
    expect(exceedsProfileRate("threeG", cap * THROUGHPUT_MISMATCH_FACTOR + 1)).toBe(true);
    expect(exceedsProfileRate("threeG", cap * THROUGHPUT_MISMATCH_FACTOR)).toBe(false);
  });

  it("never flags profiles without a single cap, or a missing measurement", () => {
    expect(exceedsProfileRate("standard", 1e12)).toBe(false);
    expect(exceedsProfileRate("variable", 1e12)).toBe(false);
    expect(exceedsProfileRate("fourG", null)).toBe(false);
  });
});
