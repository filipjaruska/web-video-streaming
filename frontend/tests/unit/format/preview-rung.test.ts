import { describe, expect, it } from "vite-plus/test";

import { pickPreviewRung } from "@/lib/analysisTargets";
import type { AnalysisTarget } from "@/lib/videoAnalysisApi";

/** A packaging run whose analysis measured these HLS rungs. */
function run(...labels: string[]): AnalysisTarget {
  const summary = { mean: 90, harmonicMean: 90, min: 80, max: 95 };
  return {
    id: "t",
    label: "run",
    kind: "transcode",
    status: "completed",
    tree: { id: "root", label: "root", children: [] },
    series: {
      vmafByFormat: {
        hls: Object.fromEntries(labels.map((label) => [label, { scores: [], summary }])),
      },
    },
  };
}

describe("pickPreviewRung", () => {
  it("takes 360p when the ladder has it", () => {
    expect(pickPreviewRung(run("1080p", "720p", "360p", "234p"))).toBe("360p");
  });

  it("steps down to the highest rung below 360p when it was dropped", () => {
    expect(pickPreviewRung(run("1080p-1520k", "720p", "540p", "234p"))).toBe("234p");
  });

  it("takes the lowest rung when every rung is above 360p", () => {
    expect(pickPreviewRung(run("1080p", "720p-700k", "540p", "432p"))).toBe("432p");
  });

  it("prefers the plain rung over a gap-filling one at the same height", () => {
    expect(pickPreviewRung(run("360p-250k", "360p", "720p"))).toBe("360p");
  });

  it("guesses 360p before anything has been measured", () => {
    expect(pickPreviewRung(undefined)).toBe("360p");
    expect(pickPreviewRung(run())).toBe("360p");
  });
});
