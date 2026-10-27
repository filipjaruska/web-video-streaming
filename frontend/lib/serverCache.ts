import { cacheLife, cacheTag } from "next/cache";

import { collectVmafEntries } from "@/lib/analysisTargets";
import type { CacheTag } from "@/lib/cacheTags";
import { getApiUrl } from "@/lib/env";
import type { Chapter5Report } from "@/lib/results/chapter5";
import { fetchChapter5, fetchVideoReport } from "@/lib/results/loadChapter5";
import { slimAnalysis } from "@/lib/results/slimAnalysis";
import { listVideos, type ListVideosResponse } from "@/lib/videoApi";
import { getVideoAnalysis, type VideoAnalysisResponse } from "@/lib/videoAnalysisApi";
import { getVideoBenchmarks, type VideoBenchmarksResponse } from "@/lib/videoBenchmarksApi";

/**
 * Everything the server caches from the backend, in one place.
 *
 * Each entry is filed under the tags of what it was built from and kept until the backend reports
 * a write to one of them (`app/api/revalidate`) or the Refresh button expires them. The entries go
 * to the remote cache: on Vercel every function instance shares it, where in-memory entries would
 * be rebuilt by each instance, and a rebuild reads megabytes from the backend. A loader that throws
 * stores nothing, so a failed request is retried by the next one.
 */
function cachedUntilChanged(...tags: CacheTag[]) {
  // The hour is only a fallback for a call from the backend that never arrived. 30 s is the
  // shortest time the browser's router may reuse a page without asking.
  cacheLife({ stale: 30, revalidate: 60 * 60, expire: 24 * 60 * 60 });
  cacheTag(...tags);
}

// The documents are megabytes each, so they are read uncached and only what is built from them is
// stored.
const NO_STORE: RequestInit = { cache: "no-store" };

export async function loadCatalogue(): Promise<ListVideosResponse> {
  "use cache: remote";
  cachedUntilChanged("videos");
  return listVideos();
}

/** The chapter 5 report over every video. */
export async function loadChapter5(): Promise<Chapter5Report> {
  "use cache: remote";
  cachedUntilChanged("videos", "analysis", "benchmarks");
  return fetchChapter5(getApiUrl());
}

/** The same report for one video, for its own Results tab; `null` when the video does not exist. */
export async function loadVideoReport(routeId: string): Promise<Chapter5Report | null> {
  "use cache: remote";
  cachedUntilChanged("videos", "analysis", "benchmarks");
  return fetchVideoReport(getApiUrl(), routeId);
}

/** The Results tab's analysis, reduced to what it draws. */
export async function loadSlimAnalysis(routeId: string): Promise<VideoAnalysisResponse> {
  "use cache: remote";
  cachedUntilChanged("analysis");
  return slimAnalysis(await getVideoAnalysis(getApiUrl(), encodeURIComponent(routeId), NO_STORE));
}

export interface VmafFrames {
  scores: number[];
  timeSec?: number[];
}

/** One packaged rung's per-frame VMAF, which the reduced analysis leaves out. */
export async function loadVmafFrames(
  routeId: string,
  targetId: string,
  format: string,
  label: string,
): Promise<VmafFrames | null> {
  "use cache: remote";
  cachedUntilChanged("analysis");
  const analysis = await getVideoAnalysis(getApiUrl(), encodeURIComponent(routeId), NO_STORE);
  const target = analysis.targets.find((item) => item.id === targetId);
  const entry = collectVmafEntries(target?.series.vmafByFormat).find(
    (item) => item.format === format && item.label === label,
  );
  return entry ? { scores: entry.data.scores, timeSec: entry.data.timeSec } : null;
}

/** A video's saved benchmark runs and their aggregates, without the traces. */
export async function loadVideoBenchmarks(routeId: string): Promise<VideoBenchmarksResponse> {
  "use cache: remote";
  cachedUntilChanged("benchmarks");
  return getVideoBenchmarks(getApiUrl(), encodeURIComponent(routeId), NO_STORE);
}
