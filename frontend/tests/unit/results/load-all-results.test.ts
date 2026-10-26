import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { loadAllResults, type ClipResult } from "@/lib/resultsApi";
import type { AnalysisTarget, VideoAnalysisResponse } from "@/lib/videoAnalysisApi";
import type { ListVideosResponse, VideoListItem } from "@/lib/videoApi";
import type { BenchmarkAggregateDto, VideoBenchmarksResponse } from "@/lib/videoBenchmarksApi";

const API = "http://results.test";

function video(routeId: string, title: string | null = routeId): VideoListItem {
  return {
    routeId,
    title,
    description: null,
    status: "ready",
    fileName: `${routeId}.mkv`,
    thumbnailUrl: null,
    size: 1,
    createdAt: "2026-01-01T00:00:00Z",
    publishedAt: null,
    hasHls: true,
    hasDash: true,
  };
}

const tree = { id: "root", label: "root", children: [] };

const source: AnalysisTarget = {
  id: "source",
  label: "Source",
  kind: "source",
  status: "completed",
  tree,
  series: {
    siti: { si: [10, 20, 30], ti: [1, 2, 3], timeSec: [0, 1, 2] },
    duplicateFrameShare: 0.4,
    sourceCambi: 0.2,
  },
};

const staticWithComparison: AnalysisTarget = {
  id: "t-static",
  label: "Static ladder",
  kind: "transcode",
  status: "completed",
  transcodeId: "s",
  ladderKind: "static",
  tree,
  series: {
    ladderComparison: {
      staticPoints: [],
      ladders: [
        {
          ladderKind: "dynamic",
          label: "Dynamic",
          bdRatePercent: -8.1,
          bdRateHighBandPercent: -6.4,
          overlapLowVmaf: 40,
          overlapHighVmaf: 95,
          points: [],
        },
        {
          ladderKind: "animation",
          label: "Animation",
          bdRatePercent: 999,
          overlapLowVmaf: 0,
          overlapHighVmaf: 0,
          bitrateSavingPercent: 3,
          points: [],
          error: "curves do not overlap",
        },
      ],
    },
    tuningComparison: {
      tune: "animation",
      decimate: false,
      bdRatePercent: -2.5,
      bdRateByResolution: { "1080p": -3, "720p": -2 },
      meanVmafDelta: 0.3,
      pairs: [
        {
          label: "1080p",
          height: 1080,
          crf: 23,
          baseVmaf: 90,
          tunedVmaf: 90.3,
          vmafDelta: 0.3,
          baseBitrateBps: 1,
          tunedBitrateBps: 1,
        },
      ],
    },
  },
};

const aggregate: BenchmarkAggregateDto = {
  networkProfile: "FourG",
  ladderKind: "static",
  protocol: "hls",
  abrAlgorithm: "hybrid",
  runs: 3,
  startupMsMean: 800,
  startupMsStdDev: 40,
  bufferingRatioMean: 0,
  bufferingRatioStdDev: 0,
  qualitySwitchesMean: 2,
  oscillationsMean: 0,
  timeWeightedBitrateBpsMean: 4_000_000,
  rebufferMsMean: 0,
  rebufferCountMean: 0,
};

type Route = { status: number; body?: unknown };

function analysis(routeId: string, targets: AnalysisTarget[]): Route {
  const body: VideoAnalysisResponse = { routeId, schemaVersion: 1, updatedAtUtc: null, targets };
  return { status: 200, body };
}

function benchmarks(routeId: string, aggregates: BenchmarkAggregateDto[] = [aggregate]): Route {
  const body: VideoBenchmarksResponse = { routeId, schemaVersion: 1, runs: [], aggregates };
  return { status: 200, body };
}

/** A fake API: one clip per row status the results page distinguishes. */
const routes: Record<string, Route> = {
  "/api/videos": {
    status: 200,
    body: {
      count: 5,
      videos: [
        video("complete"),
        video("partial"),
        video("missing"),
        video("broken", null),
        video("nobench"),
      ],
    } satisfies ListVideosResponse,
  },
  "/api/videos/complete/analysis": analysis("complete", [source, staticWithComparison]),
  "/api/videos/complete/benchmarks": benchmarks("complete"),
  "/api/videos/partial/analysis": analysis("partial", [
    source,
    { ...staticWithComparison, series: {} },
  ]),
  "/api/videos/partial/benchmarks": benchmarks("partial", []),
  "/api/videos/missing/analysis": analysis("missing", []),
  "/api/videos/missing/benchmarks": benchmarks("missing", []),
  "/api/videos/broken/analysis": { status: 500 },
  "/api/videos/broken/benchmarks": benchmarks("broken"),
  "/api/videos/nobench/analysis": analysis("nobench", [source, staticWithComparison]),
  "/api/videos/nobench/benchmarks": { status: 503 },
};

let results: Record<string, ClipResult>;

beforeEach(async () => {
  vi.stubEnv("API_URL", API);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const route = routes[new URL(String(input)).pathname];
      if (!route) {
        return new Response(null, { status: 404 });
      }
      return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
        status: route.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  results = Object.fromEntries((await loadAllResults()).map((row) => [row.routeId, row]));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("loadAllResults", () => {
  it("keeps one row per clip, in catalogue order, even for failures", async () => {
    expect(Object.keys(results)).toEqual(["complete", "partial", "missing", "broken", "nobench"]);
  });

  it("reduces a fully analysed clip to its content figures, ladders, tuning and benchmarks", () => {
    const row = results.complete;
    expect(row.status).toBe("complete");
    expect(row.content).toEqual({
      meanSi: 20,
      meanTi: 2,
      duplicateFrameShare: 0.4,
      sourceCambi: 0.2,
      durationSec: 2,
      frames: 3,
    });
    expect(row.tuning).toMatchObject({ tune: "animation", pairs: 1, bdRatePercent: -2.5 });
    expect(row.benchmarks).toEqual([aggregate]);
    expect(row.errors).toEqual([]);
  });

  it("blanks a ladder's BD-rate figures when its comparison failed, but keeps the error", () => {
    const [dynamic, animation] = results.complete.ladders;
    expect(dynamic).toMatchObject({
      kind: "dynamic",
      bdRatePercent: -8.1,
      bdRateHighBandPercent: -6.4,
    });
    expect(animation).toMatchObject({
      kind: "animation",
      bdRatePercent: null,
      overlapLowVmaf: null,
      bitrateSavingPercent: 3,
      error: "curves do not overlap",
    });
  });

  it("marks a clip partial when the source is analysed but the ladders are not compared yet", () => {
    expect(results.partial.status).toBe("partial");
    expect(results.partial.ladders).toEqual([]);
    expect(results.partial.content?.frames).toBe(3);
  });

  it("marks a clip missing when there is no source analysis", () => {
    expect(results.missing).toMatchObject({ status: "missing", content: null });
  });

  it("contains an analysis failure to its row and falls back to the file name", () => {
    expect(results.broken.status).toBe("error");
    expect(results.broken.title).toBe("broken.mkv");
    expect(results.broken.errors[0]).toMatch(/^Analysis: .*500/);
    expect(results.broken.benchmarks).toEqual([aggregate]);
  });

  it("keeps the ladder results when only the benchmarks failed", () => {
    expect(results.nobench.status).toBe("complete");
    expect(results.nobench.benchmarks).toEqual([]);
    expect(results.nobench.errors[0]).toMatch(/^Benchmarks: .*503/);
  });
});
