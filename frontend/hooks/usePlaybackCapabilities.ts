"use client";

import { useEffect, useState } from "react";
import {
  detectPlaybackCapabilities,
  type PlaybackCapabilities,
} from "@/lib/playbackCapabilities";

/**
 * Probes the browser once, after mount.
 *
 * Not a lazy `useState` initialiser: that would run during server rendering, where the probe
 * returns null, and then produce a different value on the client — a hydration mismatch. The
 * effect form makes the first client render agree with the server and the probe land immediately
 * after.
 */
export function usePlaybackCapabilities(): PlaybackCapabilities | null {
  const [capabilities, setCapabilities] = useState<PlaybackCapabilities | null>(
    null,
  );

  useEffect(() => {
    setCapabilities(detectPlaybackCapabilities());
  }, []);

  return capabilities;
}
