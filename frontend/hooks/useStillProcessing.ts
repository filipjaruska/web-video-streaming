"use client";

import { useEffect, useState } from "react";

import { currentDocument, getPublicApiUrl } from "@/lib/env";
import type { ListVideosResponse } from "@/lib/videoApi";

const CHECK_MS = 30_000;

/**
 * `processing` (the page's answer when it rendered) until the catalogue says the video is no
 * longer processing. A pipeline that fails leaves no other trace the polling hooks can see: the
 * transcodes and the analysis just stop changing, so they would be polled for as long as the tab
 * stays open.
 */
export function useStillProcessing(routeId: string, processing: boolean): boolean {
  const [ended, setEnded] = useState(false);
  const still = processing && !ended;

  useEffect(() => {
    if (!still) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`${getPublicApiUrl()}/api/videos`, currentDocument());
        if (!res.ok) {
          return;
        }
        const { videos } = (await res.json()) as ListVideosResponse;
        if (videos.find((video) => video.routeId === routeId)?.status !== "processing") {
          setEnded(true);
        }
      } catch {
        // Unreachable for now; the next check tries again.
      }
    }, CHECK_MS);
    return () => window.clearInterval(timer);
  }, [still, routeId]);

  return still;
}
