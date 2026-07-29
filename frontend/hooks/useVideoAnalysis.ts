"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getVideoAnalysis,
  type VideoAnalysisResponse,
} from "@/lib/videoAnalysisApi";
import { getPublicApiUrl } from "@/lib/env";

function hasRunningSections(response: VideoAnalysisResponse) {
  return response.targets.some(
    (target) =>
      target.status === "running" ||
      target.tree.children.some(
        (section) =>
          section.meta?.status === "running" ||
          section.meta?.status === "pending",
      ),
  );
}

export function useVideoAnalysis(routeId: string) {
  const [data, setData] = useState<VideoAnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
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
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!data || !hasRunningSections(data)) {
      return;
    }

    const interval = window.setInterval(() => {
      void reload();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [data, reload]);

  return {
    data,
    error,
    loading,
    reload,
    isPolling: data != null && hasRunningSections(data),
  };
}
