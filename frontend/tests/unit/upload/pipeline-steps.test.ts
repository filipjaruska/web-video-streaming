import { describe, expect, it } from "vite-plus/test";

import { PIPELINE_STEP_KEYS, phaseStates } from "@/lib/pipelineSteps";

describe("pipeline phases", () => {
  it("covers the backend's 25 steps once each, in run order", () => {
    expect(PIPELINE_STEP_KEYS).toHaveLength(25);
    expect(new Set(PIPELINE_STEP_KEYS).size).toBe(25);
    expect(PIPELINE_STEP_KEYS[0]).toBe("Starting");
    expect(PIPELINE_STEP_KEYS.at(-1)).toBe("LadderComparison");
  });

  it("marks earlier phases done and the one holding the current step current", () => {
    expect(phaseStates("Processing", "EncodeGrid")).toEqual({
      source: "done",
      static: "done",
      grid: "current",
      dynamic: "pending",
      animationGrid: "pending",
      animation: "pending",
      comparison: "pending",
    });
  });

  it("marks the phase that failed and leaves the rest pending", () => {
    const states = phaseStates("Failed", "AnimationEncode");
    expect(states.animationGrid).toBe("done");
    expect(states.animation).toBe("failed");
    expect(states.comparison).toBe("pending");
  });

  it("is all pending before processing and all done after", () => {
    expect(Object.values(phaseStates("Queued", null))).toEqual(Array(7).fill("pending"));
    expect(Object.values(phaseStates("Completed", null))).toEqual(Array(7).fill("done"));
  });

  it("does not guess from a step key it does not know", () => {
    expect(Object.values(phaseStates("Processing", "SomethingNew"))).toEqual(
      Array(7).fill("pending"),
    );
  });
});
