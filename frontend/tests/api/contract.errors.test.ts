import { describe, expect, it } from "vite-plus/test";

import { getVideoUrl } from "@/lib/streamingLabels";
import { getUploadSession } from "@/lib/videoApi";
import { getVideoAnalysis } from "@/lib/videoAnalysisApi";
import { getVideoBenchmarks } from "@/lib/videoBenchmarksApi";
import { getVideoSubtitles } from "@/lib/videoSubtitlesApi";
import { getVideoTranscodes } from "@/lib/videoTranscodesApi";

import { apiUrl, backendUp, listRouteIds } from "./support/env";

const unknown = "no-such-clip";
const [someClip] = await listRouteIds();

async function status(path: string, init?: RequestInit): Promise<number> {
  return (await fetch(`${apiUrl}${path}`, init)).status;
}

describe.skipIf(!backendUp)("error contract", () => {
  it.each([
    `/api/videos/${unknown}/transcodes`,
    `/api/videos/${unknown}/analysis`,
    `/api/videos/${unknown}/benchmarks`,
    `/api/videos/${unknown}/subs`,
    `/api/videos/${unknown}/thumbnail`,
    `/api/hls/${unknown}/master.m3u8`,
    `/api/dash/${unknown}/manifest.mpd`,
    `/api/httprange/${unknown}`,
    "/api/uploadSessions/00000000-0000-0000-0000-000000000000",
    "/api/uploadSessions/not-a-guid",
  ])("answers 404 for %s", async (path) => {
    expect(await status(path)).toBe(404);
  });

  it("turns a missing clip into the result each client promises the UI", async () => {
    await expect(getVideoTranscodes(apiUrl, unknown)).rejects.toThrow(/404/);
    await expect(getVideoAnalysis(apiUrl, unknown)).rejects.toThrow(/404/);
    await expect(getVideoBenchmarks(apiUrl, unknown)).rejects.toThrow(/404/);
    await expect(getUploadSession(apiUrl, crypto.randomUUID())).rejects.toThrow(/404/);
    // Subtitles are optional on the player page, so a missing clip just has none.
    expect(await getVideoSubtitles(apiUrl, unknown)).toEqual({
      routeId: unknown,
      tracks: [],
      skipped: [],
    });
  });

  describe.skipIf(!someClip)("on an existing clip", () => {
    it.each([
      () => `/api/hls/${someClip}/t/no-such-run/master.m3u8`,
      () => `/api/dash/${someClip}/t/no-such-run/manifest.mpd`,
      () => `/api/hls/${someClip}/no-such-rung.m3u8`,
      () => `/api/videos/${someClip}/subs/no-such-track.vtt`,
    ])("answers 404 for an unknown run, rung or track (%#)", async (path) => {
      expect(await status(path())).toBe(404);
    });

    it.each([
      () => `/api/hls/${someClip}/..%2f..%2fapp.db`,
      () => `/api/dash/${someClip}/..%2F..%2Fapp.db`,
      () => `/api/hls/${someClip}/%2e%2e%5capp.db`,
      () => `/api/videos/${someClip}/subs/..%2f..%2fapp.db`,
    ])("refuses a path-traversal segment name (%#)", async (path) => {
      const code = await status(path());
      expect(code).toBeGreaterThanOrEqual(400);
      expect(code).toBeLessThan(500);
    });

    it("answers 416 for a byte range past the end of the file", async () => {
      const url = getVideoUrl("source", apiUrl, someClip);
      expect((await fetch(url, { headers: { Range: "bytes=999999999999-" } })).status).toBe(416);
    });
  });
});
