import { describe, expect, it } from "vite-plus/test";

import { fetchChapter5 } from "@/lib/results/loadChapter5";
import { listVideos } from "@/lib/videoApi";

import {
  checkAnalysis,
  checkBenchmarkTraces,
  checkBenchmarks,
  checkSubtitles,
  checkThumbnail,
  checkTranscodes,
  isFullyProcessed,
} from "./support/checks";
import { apiUrl, backendUp, fetchOk, listRouteIds } from "./support/env";
import { expectSchema, listVideosResponse } from "./support/schemas";

const routeIds = await listRouteIds();

describe.skipIf(!backendUp)(`read API at ${apiUrl}`, () => {
  it("answers the health check", async () => {
    expect(await (await fetchOk("/health")).text()).toBe("Healthy");
  });

  it("lists the catalogue in the shape the home page renders", async () => {
    const body = expectSchema(listVideosResponse, await listVideos(), "video list");
    expect(body.count).toBe(body.videos.length);
    expect(new Set(body.videos.map((video) => video.routeId)).size).toBe(body.count);
  });

  it("exports the database as a SQLite file", async () => {
    const res = await fetchOk("/api/database/export");
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    const head = new Uint8Array(await res.arrayBuffer()).slice(0, 15);
    expect(new TextDecoder().decode(head)).toBe("SQLite format 3");
  });

  it("builds the chapter 5 report from every clip without a load error", async () => {
    const report = await fetchChapter5(apiUrl);
    expect(report.clips.map((clip) => clip.routeId).toSorted()).toEqual(routeIds.toSorted());
    for (const clip of report.clips) {
      expect(clip.errors, clip.routeId).toEqual([]);
    }
    expect(report.content).toHaveLength(routeIds.length);
  });
});

describe.skipIf(!backendUp || routeIds.length === 0).each(routeIds)("clip %s", (routeId) => {
  it("serves its packaging runs, analysis, benchmarks, subtitles and thumbnail", async () => {
    const transcodes = await checkTranscodes(routeId);
    await checkAnalysis(routeId, isFullyProcessed(transcodes));
    await checkBenchmarkTraces(routeId, await checkBenchmarks(routeId));
    await checkSubtitles(routeId);
    await checkThumbnail(routeId);
  });
});
