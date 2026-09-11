import { getVideoAnalysis } from "@/lib/videoAnalysisApi";
import type { LadderQuality } from "./types";

const normaliseId = (id: string | null | undefined) => id?.replace(/-/g, "").toLowerCase();

/**
 * The top rung and each rung's measured harmonic VMAF for one packaging run, read from its analysis.
 * This is what turns "which rung was on screen" into "what quality the viewer received".
 *
 * Loaded once per sweep. The analysis document is large — it carries per-frame scores — but one
 * fetch before a sweep that plays for minutes is negligible. Returns null for the source cell and
 * whenever the scores are unavailable; the runs are then recorded without a delivered VMAF.
 */
export async function loadLadderQuality(
  apiUrl: string,
  routeId: string,
  transcodeId: string | null,
): Promise<LadderQuality | null> {
  if (!transcodeId) {
    return null;
  }

  try {
    const analysis = await getVideoAnalysis(apiUrl, routeId);
    const target = analysis.targets.find(
      (item) => normaliseId(item.transcodeId) === normaliseId(transcodeId),
    );

    // HLS and DASH carry the same encoded rungs, so either format's scores describe both.
    const byRung = target?.series.vmafByFormat?.hls ?? target?.series.vmafByFormat?.dash;
    if (!byRung) {
      return null;
    }

    const vmafByHeight: Record<number, number> = {};
    for (const [label, series] of Object.entries(byRung)) {
      const height = series.summary.height ?? Number.parseInt(label, 10);
      if (Number.isFinite(height) && height > 0 && series.summary.harmonicMean > 0) {
        vmafByHeight[height] = series.summary.harmonicMean;
      }
    }

    const heights = Object.keys(vmafByHeight).map(Number);
    return heights.length > 0 ? { topHeight: Math.max(...heights), vmafByHeight } : null;
  } catch {
    return null;
  }
}
