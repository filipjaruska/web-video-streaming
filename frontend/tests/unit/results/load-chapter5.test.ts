import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Chapter5Report } from "@/lib/results/chapter5";
import { loadChapter5 } from "@/lib/results/loadChapter5";
import type { AnalysisTarget, VideoAnalysisResponse } from "@/lib/videoAnalysisApi";
import type { ListVideosResponse, VideoListItem } from "@/lib/videoApi";
import type {
  BenchmarkAggregateDto,
  VideoBenchmarkTracesResponse,
  VideoBenchmarksResponse,
} from "@/lib/videoBenchmarksApi";

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
          bdVmaf: 1.2,
          overlapLowVmaf: 40,
          overlapHighVmaf: 95,
          points: [],
        },
      ],
    },
  },
};

const aggregate: BenchmarkAggregateDto = {
  networkProfile: "FourG",
  ladderKind: "source",
  protocol: "source",
  abrAlgorithm: "baseline",
  runs: 3,
  startupMsMean: 800,
  startupMsStdDev: 40,
  bufferingRatioMean: 0.01,
  bufferingRatioStdDev: 0,
  qualitySwitchesMean: 0,
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

function benchmarks(routeId: string): Route {
  const body: VideoBenchmarksResponse = {
    routeId,
    schemaVersion: 1,
    runs: [],
    aggregates: [aggregate],
  };
  return { status: 200, body };
}

function traces(routeId: string): Route {
  const body: VideoBenchmarkTracesResponse = { routeId, schemaVersion: 1, runs: [] };
  return { status: 200, body };
}

/** A fake API: a complete clip, one whose analysis fails, and one whose benchmarks fail. */
const routes: Record<string, Route> = {
  "/api/videos": {
    status: 200,
    body: {
      count: 3,
      videos: [video("zeta"), video("broken", null), video("alpha")],
    } satisfies ListVideosResponse,
  },
  "/api/videos/zeta/analysis": analysis("zeta", [source, staticWithComparison]),
  "/api/videos/zeta/benchmarks": benchmarks("zeta"),
  "/api/videos/zeta/benchmarks/traces": traces("zeta"),
  "/api/videos/broken/analysis": { status: 500 },
  "/api/videos/broken/benchmarks": benchmarks("broken"),
  "/api/videos/broken/benchmarks/traces": traces("broken"),
  "/api/videos/alpha/analysis": analysis("alpha", [source, staticWithComparison]),
  "/api/videos/alpha/benchmarks": { status: 503 },
  "/api/videos/alpha/benchmarks/traces": { status: 503 },
};

let report: Chapter5Report;

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
  report = await loadChapter5();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("loadChapter5", () => {
  it("keeps one row per clip, ordered by title, even for failures", () => {
    expect(report.clips.map((clip) => clip.title)).toEqual(["alpha", "broken.mkv", "zeta"]);
    expect(report.content.map((row) => row.routeId)).toEqual(["alpha", "broken", "zeta"]);
  });

  it("reduces a loaded clip to its table rows", () => {
    const zeta = report.clips.find((clip) => clip.routeId === "zeta");
    expect(zeta).toMatchObject({ complete: true, errors: [] });
    expect(report.content[2]).toMatchObject({ siMean: 20, tiMean: 2, duplicateFrameShare: 0.4 });
    expect(report.ladders[2].ladders.dynamic).toMatchObject({ bdRate: -8.1, bdVmaf: 1.2 });
    expect(report.progressive[2].byProfile.fourG).toEqual({
      startupMs: 800,
      bufferingRatio: 0.01,
      runs: 3,
    });
  });

  it("contains an analysis failure to its clip and says what failed", () => {
    const broken = report.clips.find((clip) => clip.routeId === "broken");
    expect(broken?.complete).toBe(false);
    expect(broken?.errors).toHaveLength(1);
    expect(broken?.errors[0]).toMatch(/^Analysis: .*500/);
    expect(report.content[1].siMean).toBeNull();
    expect(report.progressive[1].byProfile.fourG?.startupMs).toBe(800);
  });

  it("keeps the analysis figures when only the benchmarks failed", () => {
    const alpha = report.clips.find((clip) => clip.routeId === "alpha");
    expect(alpha?.complete).toBe(true);
    expect(alpha?.errors.map((error) => error.split(":")[0])).toEqual(["Benchmarks", "Traces"]);
    expect(report.ladders[0].ladders.dynamic?.bdRate).toBe(-8.1);
    expect(report.progressive[0].byProfile.fourG).toBeNull();
  });
});
