import { describe, expect, it } from "vite-plus/test";

import { loadAllResults } from "@/lib/resultsApi";
import { listVideos } from "@/lib/videoApi";

import {
  checkAnalysis,
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

  it("builds a results row for every clip without an error", async () => {
    const rows = await loadAllResults();
    expect(rows.map((row) => row.routeId)).toEqual(routeIds);
    for (const row of rows) {
      expect(row.errors, row.routeId).toEqual([]);
      expect(["complete", "partial"], row.routeId).toContain(row.status);
    }
  });
});

describe.skipIf(!backendUp || routeIds.length === 0).each(routeIds)("clip %s", (routeId) => {
  it("serves its packaging runs, analysis, benchmarks, subtitles and thumbnail", async () => {
    const transcodes = await checkTranscodes(routeId);
    await checkAnalysis(routeId, isFullyProcessed(transcodes));
    await checkBenchmarks(routeId);
    await checkSubtitles(routeId);
    await checkThumbnail(routeId);
  });
});
