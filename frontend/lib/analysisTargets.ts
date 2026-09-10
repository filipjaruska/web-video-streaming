import type {
  AnalysisTarget,
  FormatVmafSeries,
  VmafSeriesData,
} from "@/lib/videoAnalysisApi";

export type FormatKey = "hls" | "dash";

export interface VmafEntry {
  format: FormatKey;
  label: string;
  data: VmafSeriesData;
}

/**
 * Resolution of the analysis targets a video produced.
 *
 * Shared rather than inlined because the per-video analysis view and the cross-clip results page
 * must agree on which packaging run they are reporting. If they resolved targets independently
 * they could show different numbers for the same clip, which is the one failure mode neither page
 * could survive.
 */
export function pickSourceTarget(targets: AnalysisTarget[]): AnalysisTarget | undefined {
  return targets.find((target) => target.kind === "source");
}

export function pickTranscodeTargets(targets: AnalysisTarget[]): AnalysisTarget[] {
  return targets.filter((target) => target.kind === "transcode");
}

/**
 * The static run, which is also where every derived artefact is stored.
 *
 * The pipeline writes the encode grids, both derived ladders, the ladder comparison and the tuning
 * comparison onto the *static* transcode's report, because they are all derived from it. The
 * fallback covers runs recorded before `ladderKind` was populated.
 */
export function pickStaticTranscode(targets: AnalysisTarget[]): AnalysisTarget | undefined {
  const transcodes = pickTranscodeTargets(targets);
  return (
    transcodes.find((target) => target.ladderKind === "static") ??
    transcodes.find((target) => target.series.encodeGrid?.length)
  );
}

export function pickDynamicTranscode(targets: AnalysisTarget[]): AnalysisTarget | undefined {
  return pickTranscodeTargets(targets).find((target) => target.ladderKind === "dynamic");
}

export function pickAnimationTranscode(targets: AnalysisTarget[]): AnalysisTarget | undefined {
  return pickTranscodeTargets(targets).find((target) => target.ladderKind === "animation");
}

/** Every packaged rendition that produced a VMAF series, flattened across both formats. */
export function collectVmafEntries(byFormat: FormatVmafSeries | undefined): VmafEntry[] {
  if (!byFormat) {
    return [];
  }

  const entries: VmafEntry[] = [];

  for (const format of ["hls", "dash"] as const) {
    const map = byFormat[format];
    if (!map) {
      continue;
    }

    for (const [label, data] of Object.entries(map)) {
      entries.push({ format, label, data });
    }
  }

  return entries;
}

/** Packaging runs that have at least one measured rendition, i.e. that can be charted. */
export function pickPackagedWithVmaf(targets: AnalysisTarget[]): AnalysisTarget[] {
  return pickTranscodeTargets(targets).filter(
    (target) => collectVmafEntries(target.series.vmafByFormat).length > 0,
  );
}
