import { getApiUrl } from "@/lib/env";
import { listVideos } from "@/lib/videoApi";
import { getVideoAnalysis } from "@/lib/videoAnalysisApi";
import { getVideoBenchmarkTraces, getVideoBenchmarks } from "@/lib/videoBenchmarksApi";

import { buildChapter5, type Chapter5Report, type ClipData } from "./chapter5";

const REVALIDATE: RequestInit = { next: { revalidate: 60, tags: ["analysis", "benchmarks"] } };

/**
 * Loads every clip's analysis, benchmark aggregates and run traces and reduces them to the chapter
 * 5 report. Server-side only: the analysis documents carry per-frame scores (megabytes per clip),
 * and only the reduced rows should reach the browser. A clip whose data fails to load still gets
 * its rows, with the missing parts empty.
 */
export async function loadChapter5(): Promise<Chapter5Report> {
  const apiUrl = getApiUrl();
  const { videos } = await listVideos();

  const clips = await Promise.all(
    videos.map(async (video): Promise<ClipData> => {
      const [analysis, benchmarks, traces] = await Promise.allSettled([
        getVideoAnalysis(apiUrl, video.routeId, REVALIDATE),
        getVideoBenchmarks(apiUrl, video.routeId, REVALIDATE),
        getVideoBenchmarkTraces(apiUrl, video.routeId, REVALIDATE),
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
    }),
  );

  return buildChapter5(clips);
}
