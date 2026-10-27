"use client";

import { useEffect } from "react";

/** The id a hash names; a malformed escape ("#100%") names nothing rather than throwing. */
function sectionId(hash: string): string | null {
  try {
    return decodeURIComponent(hash.slice(1)) || null;
  } catch {
    return null;
  }
}

/**
 * Scrolls to the section named in the URL hash once `ready` turns true.
 *
 * Pages that load their content in the browser render the sections after the navigation, so the
 * browser's own jump to `#section` finds nothing (or lands before content above it has grown).
 * Runs once per load, in the frame after the sections render.
 */
export function useScrollToHash(ready: boolean) {
  useEffect(() => {
    if (!ready) {
      return;
    }
    const id = sectionId(window.location.hash);
    if (!id) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ready]);
}
