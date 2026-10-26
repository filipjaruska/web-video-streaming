/**
 * The processing pipeline's steps, grouped into the phases the upload timeline and the pipeline
 * cost table show. Keys mirror `PipelineStep` in `backend/Core/ProcessingEta.cs`, in run order.
 */
export const PIPELINE_PHASES = [
  {
    id: "source",
    label: "Source analysis",
    steps: [
      { key: "Starting", label: "Preparing the source" },
      { key: "Subtitles", label: "Subtitles" },
      { key: "MediaInfo", label: "Media info" },
      { key: "SourceSiti", label: "SI and TI" },
      { key: "SourceCambi", label: "Source CAMBI" },
      { key: "Thumbnail", label: "Thumbnail" },
      { key: "AudioEncode", label: "Audio" },
    ],
  },
  {
    id: "static",
    label: "Static ladder",
    steps: [
      { key: "StaticEncode", label: "Encode" },
      { key: "StaticPackage", label: "Package HLS and DASH" },
      { key: "StaticSiti", label: "SI and TI of the rungs" },
      { key: "StaticVmaf", label: "VMAF of the rungs" },
    ],
  },
  {
    id: "grid",
    label: "Encode grid",
    steps: [
      { key: "EncodeGrid", label: "Resolution × CRF encodes" },
      { key: "DeriveLadder", label: "Derive the ladder" },
    ],
  },
  {
    id: "dynamic",
    label: "Content-adaptive ladder",
    steps: [
      { key: "DynamicEncode", label: "Encode" },
      { key: "DynamicPackage", label: "Package HLS and DASH" },
      { key: "DynamicSiti", label: "SI and TI of the rungs" },
      { key: "DynamicVmaf", label: "VMAF of the rungs" },
    ],
  },
  {
    id: "animationGrid",
    label: "Animation grid",
    steps: [
      { key: "AnimationGrid", label: "Resolution × CRF encodes, -tune animation" },
      { key: "AnimationDeriveLadder", label: "Derive the ladder" },
    ],
  },
  {
    id: "animation",
    label: "Animation-optimised ladder",
    steps: [
      { key: "AnimationEncode", label: "Encode" },
      { key: "AnimationPackage", label: "Package HLS and DASH" },
      { key: "AnimationSiti", label: "SI and TI of the rungs" },
      { key: "AnimationVmaf", label: "VMAF of the rungs" },
    ],
  },
  {
    id: "comparison",
    label: "Comparison",
    steps: [
      { key: "TuningComparison", label: "Codec tuning" },
      { key: "LadderComparison", label: "Ladders (BD-rate)" },
    ],
  },
] as const;

export type PipelinePhase = (typeof PIPELINE_PHASES)[number];

export const PIPELINE_STEP_KEYS: readonly string[] = PIPELINE_PHASES.flatMap((phase) =>
  phase.steps.map((step) => step.key),
);

/** Position of a step in run order, or -1 for a key this frontend does not know. */
export function stepIndex(key: string | null | undefined): number {
  return key ? PIPELINE_STEP_KEYS.indexOf(key) : -1;
}

export type PhaseState = "done" | "current" | "failed" | "pending";

/**
 * Where each phase stands, from the session status and the step the backend reports. A phase is
 * done once the current step lies past all of its steps; steps a clip skips (no subtitles, say)
 * change nothing, since only the position of the current step is compared.
 */
export function phaseStates(
  status: string,
  currentStepKey: string | null | undefined,
): Record<PipelinePhase["id"], PhaseState> {
  const current = stepIndex(currentStepKey);
  const entries = PIPELINE_PHASES.map((phase) => {
    if (status === "Completed") {
      return [phase.id, "done"] as const;
    }
    if ((status !== "Processing" && status !== "Failed") || current < 0) {
      return [phase.id, "pending"] as const;
    }
    const first = stepIndex(phase.steps[0].key);
    const last = stepIndex(phase.steps.at(-1)!.key);
    if (current > last) {
      return [phase.id, "done"] as const;
    }
    if (current >= first) {
      return [phase.id, status === "Failed" ? "failed" : "current"] as const;
    }
    return [phase.id, "pending"] as const;
  });
  return Object.fromEntries(entries) as Record<PipelinePhase["id"], PhaseState>;
}
