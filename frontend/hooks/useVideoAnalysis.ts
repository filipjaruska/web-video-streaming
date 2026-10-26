"use client";

import { useCallback, useEffect, useState } from "react";
import { pickStaticTranscode } from "@/lib/analysisTargets";
import { getVideoAnalysis, type VideoAnalysisResponse } from "@/lib/videoAnalysisApi";
import { getPublicApiUrl } from "@/lib/env";

const POLL_MS = 5000;

function hasRunningSections(response: VideoAnalysisResponse) {
  return response.targets.some((target) => {
    if (target.status === "running") {
      return true;
    }

    // Only treat pending sections as in-flight when the target itself is pending
    // (avoids polling forever on legacy completed packaging without analysis).
    if (target.status !== "pending") {
      return false;
    }

    return target.tree.children.some(
      (section) => section.meta?.status === "running" || section.meta?.status === "pending",
    );
  });
}

/** The ladder comparison is the pipeline's last write, so once it exists nothing more will come. */
function finished(response: VideoAnalysisResponse) {
  return !!pickStaticTranscode(response.targets)?.series.ladderComparison;
}

/**
 * The clip's analysis document. Refreshes while a section reports itself running, and with
 * `poll` also between steps, when no section is running yet the pipeline is still going: the
 * encode grids, for one, write nothing until they finish.
 */
export function useVideoAnalysis(routeId: string, { poll = false }: { poll?: boolean } = {}) {
  const [data, setData] = useState<VideoAnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setError(null);

    try {
      const response = await getVideoAnalysis(getPublicApiUrl(), routeId);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analysis");
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const running = data != null && hasRunningSections(data);
  const isPolling = running || (poll && !(data && finished(data)));

  useEffect(() => {
    if (!isPolling) {
      return;
    }

    const interval = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [isPolling, reload]);

  return { data, error, loading, reload, isPolling };
}
