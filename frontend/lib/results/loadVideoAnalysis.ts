import { unstable_cache } from "next/cache";

import { getApiUrl } from "@/lib/env";
import { collectVmafEntries } from "@/lib/analysisTargets";
import { getVideoAnalysis, type VideoAnalysisResponse } from "@/lib/videoAnalysisApi";

import { slimAnalysis } from "./slimAnalysis";

// The full document passes Next's 2 MB fetch-cache limit, so it is fetched fresh and only what is
// derived from it is cached.
const NO_STORE: RequestInit = { cache: "no-store" };

const CACHE = { revalidate: 60, tags: ["analysis"] };

export interface VmafFrames {
  scores: number[];
  timeSec?: number[];
}

async function fetchSlimAnalysis(apiUrl: string, routeId: string): Promise<VideoAnalysisResponse> {
  return slimAnalysis(await getVideoAnalysis(apiUrl, encodeURIComponent(routeId), NO_STORE));
}

async function fetchVmafFrames(
  apiUrl: string,
  routeId: string,
  targetId: string,
  format: string,
  label: string,
): Promise<VmafFrames | null> {
  const analysis = await getVideoAnalysis(apiUrl, encodeURIComponent(routeId), NO_STORE);
  const target = analysis.targets.find((item) => item.id === targetId);
  const entry = collectVmafEntries(target?.series.vmafByFormat).find(
    (item) => item.format === format && item.label === label,
  );
  return entry ? { scores: entry.data.scores, timeSec: entry.data.timeSec } : null;
}

const cachedSlimAnalysis = unstable_cache(fetchSlimAnalysis, ["analysis-slim"], CACHE);
const cachedVmafFrames = unstable_cache(fetchVmafFrames, ["analysis-vmaf-frames"], CACHE);

/** The Results tab's analysis, reduced and cached; the Refresh button expires it through the tag. */
export function loadSlimAnalysis(routeId: string): Promise<VideoAnalysisResponse> {
  return cachedSlimAnalysis(getApiUrl(), routeId);
}

/** One packaged rung's per-frame VMAF, which the reduced analysis leaves out. */
export function loadVmafFrames(
  routeId: string,
  targetId: string,
  format: string,
  label: string,
): Promise<VmafFrames | null> {
  return cachedVmafFrames(getApiUrl(), routeId, targetId, format, label);
}
