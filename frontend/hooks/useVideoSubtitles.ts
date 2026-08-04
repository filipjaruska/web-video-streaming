"use client";

import { useCallback, useEffect, useState } from "react";
import { getPublicApiUrl } from "@/lib/env";
import {
  getVideoSubtitles,
  type SubtitleTrack,
  type VideoSubtitlesResponse,
} from "@/lib/videoSubtitlesApi";

export function useVideoSubtitles(routeId: string) {
  const [data, setData] = useState<VideoSubtitlesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getVideoSubtitles(getPublicApiUrl(), routeId);
      setData(response);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Failed to load subtitles");
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const tracks: SubtitleTrack[] = data?.tracks ?? [];

  return { tracks, skipped: data?.skipped ?? [], loading, error, reload };
}
