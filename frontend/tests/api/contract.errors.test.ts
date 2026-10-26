import { describe, expect, it } from "vite-plus/test";

import { getUploadSession } from "@/lib/videoApi";
import { getVideoAnalysis } from "@/lib/videoAnalysisApi";
import { getVideoBenchmarks } from "@/lib/videoBenchmarksApi";
import { getVideoSubtitles } from "@/lib/videoSubtitlesApi";
import { getVideoTranscodes } from "@/lib/videoTranscodesApi";

import { checkClipErrors } from "./support/checks";
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

  // On a fresh backend (CI) there is no clip yet; e2e.upload.test.ts runs this on the one it uploads.
  it.skipIf(!someClip)(
    "refuses unknown runs, rungs, tracks, path traversal and out-of-range bytes on an existing clip",
    async () => {
      await checkClipErrors(someClip);
    },
  );
});
