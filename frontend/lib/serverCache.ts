import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";

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
 * be rebuilt by each instance, and a rebuild reads megabytes from the backend.
 *
 * A failed load is caught inside the cache scope and kept for seconds only. Thrown from there, it
 * would fail the build even where a page catches it. Short-lived entries are also left out of
 * prerendered pages, so a build that cannot reach the backend renders those parts per request
 * instead of shipping the error. The public loaders throw it again outside the scope.
 */
type Loaded<T> = { value: T } | { error: string };

// The hour is only a fallback for a call from the backend that never arrived. 30 s is the shortest
// time the browser's router may reuse a page without asking.
const UNTIL_CHANGED = { stale: 30, revalidate: 60 * 60, expire: 24 * 60 * 60 };

async function untilChanged<T>(tags: CacheTag[], load: () => Promise<T>): Promise<Loaded<T>> {
  cacheTag(...tags);
  try {
    const value = await load();
    cacheLife(UNTIL_CHANGED);
    return { value };
  } catch (err) {
    cacheLife("seconds");
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function unwrap<T>(loaded: Loaded<T>): T {
  if ("error" in loaded) {
    throw new Error(loaded.error);
  }
  return loaded.value;
}

/**
 * The fallback for a loader that failed, rendered per request rather than prerendered: that copy
 * would carry no tags, so no write would ever replace it. Use as `.catch(() => perRequest(x))`.
 */
export async function perRequest<T>(fallback: T): Promise<T> {
  await connection();
  return fallback;
}

// The documents are megabytes each, so they are read uncached and only what is built from them is
// stored.
const NO_STORE: RequestInit = { cache: "no-store" };

async function cachedCatalogue(): Promise<Loaded<ListVideosResponse>> {
  "use cache: remote";
  return untilChanged(["videos"], listVideos);
}

export async function loadCatalogue(): Promise<ListVideosResponse> {
  return unwrap(await cachedCatalogue());
}

async function cachedChapter5(): Promise<Loaded<Chapter5Report>> {
  "use cache: remote";
  return untilChanged(["videos", "analysis", "benchmarks"], () => fetchChapter5(getApiUrl()));
}

/** The chapter 5 report over every video. */
export async function loadChapter5(): Promise<Chapter5Report> {
  return unwrap(await cachedChapter5());
}

async function cachedVideoReport(routeId: string): Promise<Loaded<Chapter5Report | null>> {
  "use cache: remote";
  return untilChanged(["videos", "analysis", "benchmarks"], () =>
    fetchVideoReport(getApiUrl(), routeId),
  );
}

/** The same report for one video, for its own Results tab; `null` when the video does not exist. */
export async function loadVideoReport(routeId: string): Promise<Chapter5Report | null> {
  return unwrap(await cachedVideoReport(routeId));
}

async function cachedSlimAnalysis(routeId: string): Promise<Loaded<VideoAnalysisResponse>> {
  "use cache: remote";
  return untilChanged(["analysis"], async () =>
    slimAnalysis(await getVideoAnalysis(getApiUrl(), encodeURIComponent(routeId), NO_STORE)),
  );
}

/** The Results tab's analysis, reduced to what it draws. */
export async function loadSlimAnalysis(routeId: string): Promise<VideoAnalysisResponse> {
  return unwrap(await cachedSlimAnalysis(routeId));
}

export interface VmafFrames {
  scores: number[];
  timeSec?: number[];
}

async function cachedVmafFrames(
  routeId: string,
  targetId: string,
  format: string,
  label: string,
): Promise<Loaded<VmafFrames | null>> {
  "use cache: remote";
  return untilChanged(["analysis"], async () => {
    const analysis = await getVideoAnalysis(getApiUrl(), encodeURIComponent(routeId), NO_STORE);
    const target = analysis.targets.find((item) => item.id === targetId);
    const entry = collectVmafEntries(target?.series.vmafByFormat).find(
      (item) => item.format === format && item.label === label,
    );
    return entry ? { scores: entry.data.scores, timeSec: entry.data.timeSec } : null;
  });
}

/** One packaged rung's per-frame VMAF, which the reduced analysis leaves out. */
export async function loadVmafFrames(
  routeId: string,
  targetId: string,
  format: string,
  label: string,
): Promise<VmafFrames | null> {
  return unwrap(await cachedVmafFrames(routeId, targetId, format, label));
}

async function cachedVideoBenchmarks(routeId: string): Promise<Loaded<VideoBenchmarksResponse>> {
  "use cache: remote";
  return untilChanged(["benchmarks"], () =>
    getVideoBenchmarks(getApiUrl(), encodeURIComponent(routeId), NO_STORE),
  );
}

/** A video's saved benchmark runs and their aggregates, without the traces. */
export async function loadVideoBenchmarks(routeId: string): Promise<VideoBenchmarksResponse> {
  return unwrap(await cachedVideoBenchmarks(routeId));
}
