import { listVideos, videoTitle, type VideoListItem } from "@/lib/videoApi";
import { getVideoAnalysis } from "@/lib/videoAnalysisApi";
import { getVideoBenchmarkTraces, getVideoBenchmarks } from "@/lib/videoBenchmarksApi";

import { buildChapter5, type Chapter5Report, type VideoData } from "./chapter5";

// The raw responses are megabytes per video (traces alone pass Next's 2 MB fetch-cache limit), so
// they are fetched fresh and only the reduced report is cached, by `lib/serverCache.ts`.
const NO_STORE: RequestInit = { cache: "no-store" };

async function loadVideo(apiUrl: string, video: VideoListItem): Promise<VideoData> {
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
    title: videoTitle(video),
    analysis: analysis.status === "fulfilled" ? analysis.value : null,
    benchmarks: benchmarks.status === "fulfilled" ? benchmarks.value : null,
    traces: traces.status === "fulfilled" ? traces.value : null,
    errors,
  };
}

/**
 * Loads every video's analysis, benchmark aggregates and run traces and reduces them to the chapter
 * 5 report. Server-side only: only the reduced rows should reach the browser. A video whose data
 * fails to load still gets its rows, with the missing parts empty and the failure listed.
 */
export async function fetchChapter5(apiUrl: string): Promise<Chapter5Report> {
  const { videos } = await listVideos();
  return buildChapter5(await Promise.all(videos.map((video) => loadVideo(apiUrl, video))));
}

/** The same report for one video, for its own Results tab; `null` when the video does not exist. */
export async function fetchVideoReport(
  apiUrl: string,
  routeId: string,
): Promise<Chapter5Report | null> {
  const { videos } = await listVideos();
  const video = videos.find((item) => item.routeId === routeId);
  return video ? buildChapter5([await loadVideo(apiUrl, video)]) : null;
}
