"use client";

import { useCallback, useEffect, useState } from "react";
import { getPublicApiUrl } from "@/lib/env";
import {
  getVideoTranscodes,
  type VideoTranscodeListItem,
  type VideoTranscodesResponse,
} from "@/lib/videoTranscodesApi";

const POLL_MS = 5000;

/** Every ladder has finished one way or the other, so nothing more will appear. */
function settled(transcodes: VideoTranscodeListItem[]): boolean {
  return (
    transcodes.some((item) => item.ladderKind === "animation") &&
    transcodes.every((item) => item.status === "succeeded" || item.status === "failed")
  );
}

/**
 * The clip's packaging runs. With `poll`, refreshes until all three ladders have settled, so a
 * ladder packaged while the page is open shows up without a reload.
 */
export function useVideoTranscodes(routeId: string, { poll = false }: { poll?: boolean } = {}) {
  const [data, setData] = useState<VideoTranscodesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const response = await getVideoTranscodes(getPublicApiUrl(), routeId);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transcodes");
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const transcodes: VideoTranscodeListItem[] = data?.transcodes ?? [];
  const keepPolling = poll && !settled(transcodes);

  useEffect(() => {
    if (!keepPolling) {
      return;
    }
    const timer = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [keepPolling, reload]);

  return {
    transcodes,
    activeTranscodeId: data?.activeTranscodeId ?? null,
    loading,
    error,
    reload,
  };
}
