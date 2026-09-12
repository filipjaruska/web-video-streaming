import { getVideoAnalysis, type AnalysisTarget } from "@/lib/videoAnalysisApi";
import type { LadderQuality } from "./types";

const normaliseId = (id: string | null | undefined) => id?.replace(/-/g, "").toLowerCase();

function ladderQualityOf(target: AnalysisTarget): LadderQuality | null {
  // HLS and DASH carry the same encoded rungs, so either format's scores describe both.
  const byRung = target.series.vmafByFormat?.hls ?? target.series.vmafByFormat?.dash;
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
}

/**
 * The top rung and each rung's measured harmonic VMAF for every packaging run a sweep plays, read
 * from the clip's analysis. This is what turns "which rung was on screen" into "what quality the
 * viewer received".
 *
 * Loaded once per sweep, whatever the number of ladders: the analysis document is large — it carries
 * per-frame scores — but one fetch before a sweep that plays for minutes is negligible. A ladder
 * whose scores are unavailable is simply missing from the map; its runs are then recorded without a
 * delivered VMAF.
 */
export async function loadLadderQualities(
  apiUrl: string,
  routeId: string,
  transcodeIds: string[],
): Promise<Map<string, LadderQuality>> {
  const qualities = new Map<string, LadderQuality>();
  if (transcodeIds.length === 0) {
    return qualities;
  }

  try {
    const analysis = await getVideoAnalysis(apiUrl, routeId);
    for (const transcodeId of transcodeIds) {
      const target = analysis.targets.find(
        (item) => normaliseId(item.transcodeId) === normaliseId(transcodeId),
      );
      const quality = target ? ladderQualityOf(target) : null;
      if (quality) {
        qualities.set(transcodeId, quality);
      }
    }
  } catch {
    // Scores unavailable: the runs are still measured, only without a delivered VMAF.
  }

  return qualities;
}
