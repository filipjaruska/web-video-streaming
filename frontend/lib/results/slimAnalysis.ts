import type { AnalysisTarget, VideoAnalysisResponse } from "@/lib/videoAnalysisApi";

type ByFormat<T> = { hls?: Record<string, T>; dash?: Record<string, T> };

function mapRungs<T, U>(
  byFormat: ByFormat<T> | undefined,
  map: (value: T) => U,
): ByFormat<U> | undefined {
  if (!byFormat) {
    return undefined;
  }
  const mapFormat = (rungs: Record<string, T> | undefined) =>
    rungs && Object.fromEntries(Object.entries(rungs).map(([label, value]) => [label, map(value)]));
  return { hls: mapFormat(byFormat.hls), dash: mapFormat(byFormat.dash) };
}

function slimTarget(target: AnalysisTarget): AnalysisTarget {
  // The source keeps everything: its SI/TI series is the content chart, and its tree the stats.
  if (target.kind === "source") {
    return target;
  }
  const { sitiByFormat, vmafByFormat, packagingIntegrity: _integrity, ...series } = target.series;
  return {
    ...target,
    // Section statuses stay, for the check whether anything is still running.
    tree: {
      ...target.tree,
      children: target.tree.children.map(({ children: _children, ...section }) => section),
    },
    series: {
      ...series,
      // Rung labels only; the preview rung is picked from them.
      sitiByFormat: mapRungs(sitiByFormat, () => ({ si: [], ti: [] })),
      // Summaries stay for the table; the per-frame scores are loaded for the one charted rung.
      vmafByFormat: mapRungs(vmafByFormat, ({ scores: _scores, timeSec: _timeSec, ...rung }) => ({
        ...rung,
        scores: [],
      })),
    },
  };
}

/**
 * The analysis as the Results tab draws it: about a tenth of the document. Dropped are the SI/TI
 * series of every packaged rung, the per-frame VMAF scores, the integrity report and the contents
 * of the transcode trees; the Raw data tab is where those are read.
 */
export function slimAnalysis(response: VideoAnalysisResponse): VideoAnalysisResponse {
  return { ...response, targets: response.targets.map(slimTarget) };
}
