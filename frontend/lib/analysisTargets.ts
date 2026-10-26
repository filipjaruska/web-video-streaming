import type { AnalysisTarget, FormatVmafSeries, VmafSeriesData } from "@/lib/videoAnalysisApi";

export type FormatKey = "hls" | "dash";

export interface VmafEntry {
  format: FormatKey;
  label: string;
  data: VmafSeriesData;
}

/**
 * Resolution of the analysis targets a video produced.
 *
 * Shared rather than inlined because the per-video analysis view and the cross-video results page
 * must agree on which packaging run they are reporting. If they resolved targets independently
 * they could show different numbers for the same video, which is the one failure mode neither page
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

/** The rung height previews are drawn from: small enough to load fast while scrubbing. */
const PREVIEW_HEIGHT = 360;

function rungHeight(label: string): number | null {
  const match = /^(\d+)p/.exec(label);
  return match ? Number(match[1]) : null;
}

/**
 * The HLS rung a preview plays from a packaging run: 360p when the ladder has it, otherwise the
 * highest rung below it, otherwise the lowest there is. Derived ladders can drop 360p, so asking
 * for it blindly fails on them. The rungs are read off what the run's analysis measured; before
 * any of that exists, 360p is the guess.
 */
export function pickPreviewRung(target: AnalysisTarget | undefined): string {
  const labels = [
    ...Object.keys(target?.series.vmafByFormat?.hls ?? {}),
    ...Object.keys(target?.series.sitiByFormat?.hls ?? {}),
  ];
  const rungs = [...new Set(labels)]
    .map((label) => ({ label, height: rungHeight(label) }))
    .filter((rung): rung is { label: string; height: number } => rung.height !== null)
    // Plain labels ("360p") ahead of gap-filling rungs at the same height ("360p-250k").
    .toSorted((a, b) => b.height - a.height || a.label.length - b.label.length);

  if (rungs.length === 0) {
    return `${PREVIEW_HEIGHT}p`;
  }
  return (rungs.find((rung) => rung.height <= PREVIEW_HEIGHT) ?? rungs.at(-1)!).label;
}
