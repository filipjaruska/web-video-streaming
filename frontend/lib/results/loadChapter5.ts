import { unstable_cache } from "next/cache";

import { getApiUrl } from "@/lib/env";
import { listVideos, type VideoListItem } from "@/lib/videoApi";
import { getVideoAnalysis } from "@/lib/videoAnalysisApi";
import { getVideoBenchmarkTraces, getVideoBenchmarks } from "@/lib/videoBenchmarksApi";

import { buildChapter5, type Chapter5Report, type ClipData } from "./chapter5";

// The raw responses are megabytes per clip (traces alone pass Next's 2 MB fetch-cache limit), so
// they are fetched fresh and only the reduced report is cached.
const NO_STORE: RequestInit = { cache: "no-store" };

const CACHE = { revalidate: 60, tags: ["videos", "analysis", "benchmarks"] };

async function loadClip(apiUrl: string, video: VideoListItem): Promise<ClipData> {
  const [analysis, benchmarks, traces] = await Promise.allSettled([
    getVideoAnalysis(apiUrl, video.routeId, NO_STORE),
    getVideoBenchmarks(apiUrl, video.routeId, NO_STORE),
    getVideoBenchmarkTraces(apiUrl, video.routeId, NO_STORE),
  ]);
  const errors = (
    [
      ["Analysis", analysis],
      ["Benchmarks", benchmarks],
      ["Traces", traces],
    ] as const
  ).flatMap(([part, result]) =>
    result.status === "rejected" ? [`${part}: ${String(result.reason)}`] : [],
  );
  return {
    routeId: video.routeId,
    title: video.title || video.fileName || video.routeId,
    analysis: analysis.status === "fulfilled" ? analysis.value : null,
    benchmarks: benchmarks.status === "fulfilled" ? benchmarks.value : null,
    traces: traces.status === "fulfilled" ? traces.value : null,
    errors,
  };
}

/**
 * Loads every clip's analysis, benchmark aggregates and run traces and reduces them to the chapter
 * 5 report. Server-side only: only the reduced rows should reach the browser. A clip whose data
 * fails to load still gets its rows, with the missing parts empty and the failure listed.
 */
export async function fetchChapter5(apiUrl: string): Promise<Chapter5Report> {
  const { videos } = await listVideos();
  return buildChapter5(await Promise.all(videos.map((video) => loadClip(apiUrl, video))));
}

/** The same report for one clip, for its own Results tab; `null` when the clip does not exist. */
export async function fetchClipReport(
  apiUrl: string,
  routeId: string,
): Promise<Chapter5Report | null> {
  const { videos } = await listVideos();
  const video = videos.find((item) => item.routeId === routeId);
  return video ? buildChapter5([await loadClip(apiUrl, video)]) : null;
}

const cachedChapter5 = unstable_cache(fetchChapter5, ["chapter5"], CACHE);
const cachedClipReport = unstable_cache(fetchClipReport, ["chapter5-clip"], CACHE);

/** The cached report for the results page; the Refresh button expires it through the tags. */
export function loadChapter5(): Promise<Chapter5Report> {
  return cachedChapter5(getApiUrl());
}

export function loadClipReport(routeId: string): Promise<Chapter5Report | null> {
  return cachedClipReport(getApiUrl(), routeId);
}
