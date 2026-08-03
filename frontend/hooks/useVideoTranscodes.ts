"use client";

import { useCallback, useEffect, useState } from "react";
import { getPublicApiUrl } from "@/lib/env";
import {
  getVideoTranscodes,
  type VideoTranscodeListItem,
  type VideoTranscodesResponse,
} from "@/lib/videoTranscodesApi";

export function useVideoTranscodes(routeId: string) {
  const [data, setData] = useState<VideoTranscodesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getVideoTranscodes(getPublicApiUrl(), routeId);
      setData(response);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Failed to load transcodes");
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const transcodes: VideoTranscodeListItem[] = data?.transcodes ?? [];
  const activeTranscodeId = data?.activeTranscodeId ?? null;

  return {
    transcodes,
    activeTranscodeId,
    loading,
    error,
    reload,
  };
}
