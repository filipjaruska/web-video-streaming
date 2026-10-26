import { describe, expect, it } from "vite-plus/test";

import type { PlaybackCapabilities } from "@/lib/playbackCapabilities";
import { pickBestPlaybackSettings, type VideoTranscodeListItem } from "@/lib/videoTranscodesApi";
import { SOURCE_RUN_ID } from "@/types/streaming";

function transcode(overrides: Partial<VideoTranscodeListItem>): VideoTranscodeListItem {
  return {
    id: "t",
    ladderKind: "static",
    label: "Static ladder",
    hasHls: true,
    hasDash: true,
    isActive: false,
    status: "succeeded",
    createdAtUtc: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const none: PlaybackCapabilities = {
  mediaSource: false,
  managedMediaSource: false,
  nativeHls: false,
  avcInMse: false,
  aacInMse: false,
  mseHls: false,
  dash: false,
};
const desktop: PlaybackCapabilities = {
  ...none,
  mediaSource: true,
  avcInMse: true,
  aacInMse: true,
  mseHls: true,
  dash: true,
};
const oldIos: PlaybackCapabilities = { ...none, nativeHls: true };

describe("pickBestPlaybackSettings", () => {
  it("plays the active ladder over hls.js where MSE exists, with the throughput rule", () => {
    const best = pickBestPlaybackSettings(
      [transcode({ id: "a" }), transcode({ id: "b", isActive: true })],
      "b",
      desktop,
    );
    expect(best).toMatchObject({
      packagingRunId: "b",
      streamingMethod: "hls",
      abrAlgorithm: "throughput",
    });
  });

  it("prefers the id the server named over the isActive flag", () => {
    const best = pickBestPlaybackSettings(
      [transcode({ id: "a" }), transcode({ id: "b", isActive: true })],
      "a",
      desktop,
    );
    expect(best.packagingRunId).toBe("a");
  });

  it("falls back to native HLS without MSE", () => {
    const best = pickBestPlaybackSettings([transcode({})], "t", oldIos);
    expect(best.streamingMethod).toBe("hls");
    expect(best.reason).toMatch(/native/);
  });

  it("uses DASH only when the ladder has no HLS package", () => {
    const best = pickBestPlaybackSettings([transcode({ hasHls: false })], "t", desktop);
    expect(best.streamingMethod).toBe("dash");
  });

  it("keeps the pre-probe behaviour when capabilities are not known yet", () => {
    expect(pickBestPlaybackSettings([transcode({})], "t", null).streamingMethod).toBe("hls");
    expect(pickBestPlaybackSettings([transcode({ hasHls: false })], "t").streamingMethod).toBe(
      "dash",
    );
  });

  it("ignores runs that have not succeeded and falls back to the source", () => {
    const best = pickBestPlaybackSettings([transcode({ status: "failed" })], "t", desktop);
    expect(best).toMatchObject({ packagingRunId: SOURCE_RUN_ID, streamingMethod: "source" });
  });
});
