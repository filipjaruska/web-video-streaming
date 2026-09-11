"use client";

import { useEffect, useState } from "react";

/** A new server estimate closer than this to the running countdown does not reset it. */
const MIN_REANCHOR_SEC = 15;
const REANCHOR_FRACTION = 0.1;

/**
 * Counts a server time estimate down locally, second by second.
 *
 * The pipeline writes an estimate only when a step or grid sample finishes — minutes apart during
 * the encode grids — so showing the raw value freezes the figure between writes. The countdown is
 * anchored at the moment a changed estimate arrives and re-anchored only when a new one differs
 * materially, so small corrections do not make it jump back and forth. It stops at zero, which the
 * caller shows as "finishing the current step".
 */
export function useEtaCountdown(
  estimateSeconds: number | null | undefined,
  active: boolean,
): number | null {
  const [anchor, setAnchor] = useState<{ seconds: number; atMs: number } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active || estimateSeconds == null) {
      setAnchor(null);
      return;
    }

    setAnchor((current) => {
      const at = Date.now();
      if (!current) {
        return { seconds: estimateSeconds, atMs: at };
      }

      const running = Math.max(0, current.seconds - (at - current.atMs) / 1000);
      const tolerance = Math.max(MIN_REANCHOR_SEC, running * REANCHOR_FRACTION);
      return Math.abs(estimateSeconds - running) > tolerance
        ? { seconds: estimateSeconds, atMs: at }
        : current;
    });
  }, [estimateSeconds, active]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active || !anchor) {
    return null;
  }

  return Math.max(0, Math.round(anchor.seconds - (nowMs - anchor.atMs) / 1000));
}
