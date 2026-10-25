import { describe, expect, it } from "vite-plus/test";

import { getDashQuality } from "./useVideoStatsTracking";

/** A derived ladder with two 720p rungs; dash.js lists representations by ascending bandwidth. */
const representations = [
  { id: "0", index: 0, width: 960, height: 540, bandwidth: 300_000 },
  { id: "1", index: 1, width: 1280, height: 720, bandwidth: 600_000 },
  { id: "2", index: 2, width: 1280, height: 720, bandwidth: 1_500_000 },
];

function dash(scheduledId: string) {
  return {
    getRepresentationsByType: (type: string) =>
      type === "video" ? representations : [{ id: "a", bandwidth: 128_000 }],
    getCurrentRepresentationForType: () => representations.find((r) => r.id === scheduledId),
  };
}

const video = (videoHeight: number) => ({ videoHeight }) as HTMLVideoElement;

describe("getDashQuality", () => {
  it("takes the rendered rung among two of the on-screen height, not the lowest", () => {
    const quality = getDashQuality(dash("2"), video(720), ["0", "2"]);
    expect(quality?.bitrate).toBe(1_500_000 + 128_000);
  });

  it("follows the most recently rendered of the two", () => {
    expect(getDashQuality(dash("2"), video(720), ["2", "0", "1"])?.bitrate).toBe(600_000 + 128_000);
  });

  it("falls back to the scheduled rung before any has been rendered", () => {
    expect(getDashQuality(dash("2"), video(720), [])?.bitrate).toBe(1_500_000 + 128_000);
  });

  it("keeps the frame height over the schedule when the height is unique", () => {
    // Scheduled ahead to 720p while 540p is still on screen.
    expect(getDashQuality(dash("2"), video(540), ["0", "2"])?.height).toBe(540);
  });
});
