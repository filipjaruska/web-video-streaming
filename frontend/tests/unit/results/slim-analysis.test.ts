import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { collectVmafEntries, pickPreviewRung, pickStaticTranscode } from "@/lib/analysisTargets";
import { slimAnalysis } from "@/lib/results/slimAnalysis";
import type { VideoAnalysisResponse } from "@/lib/videoAnalysisApi";

/** A recorded analysis document, with all three packaging runs. */
function golden(): VideoAnalysisResponse {
  const file = join(import.meta.dirname, "../../__golden__/b6CP8AfNkQI/analysis.json");
  return JSON.parse(readFileSync(file, "utf8")) as VideoAnalysisResponse;
}

describe("slimAnalysis", () => {
  const full = golden();
  const slim = slimAnalysis(golden());
  const transcodes = (response: VideoAnalysisResponse) =>
    response.targets.filter((target) => target.kind === "transcode");

  it("keeps the source target whole", () => {
    expect(slim.targets[0]).toEqual(full.targets[0]);
  });

  it("keeps everything the charts and tables read", () => {
    const before = pickStaticTranscode(full.targets)!.series;
    const after = pickStaticTranscode(slim.targets)!.series;
    for (const field of [
      "encodeGrid",
      "encodeGridAnimation",
      "derivedLadder",
      "animationLadder",
      "animationLadderSensitivity",
      "ladderComparison",
      "tuningComparison",
    ] as const) {
      expect(after[field], field).toEqual(before[field]);
    }
  });

  it("keeps every rung's VMAF summary but drops the per-frame scores", () => {
    expect(transcodes(slim)).toHaveLength(3);
    transcodes(full).forEach((target, index) => {
      const before = collectVmafEntries(target.series.vmafByFormat);
      const after = collectVmafEntries(transcodes(slim)[index].series.vmafByFormat);
      expect(before.length).toBeGreaterThan(0);
      expect(after.map(({ format, label }) => `${format}/${label}`)).toEqual(
        before.map(({ format, label }) => `${format}/${label}`),
      );
      after.forEach((entry, rung) => {
        expect(entry.data.scores).toEqual([]);
        expect(entry.data.timeSec).toBeUndefined();
        expect(entry.data.summary).toEqual(before[rung].data.summary);
        expect(entry.data.summaryByModel).toEqual(before[rung].data.summaryByModel);
      });
    });
  });

  it("picks the same preview rung from the labels left", () => {
    transcodes(full).forEach((target, index) => {
      expect(pickPreviewRung(transcodes(slim)[index])).toBe(pickPreviewRung(target));
    });
  });

  it("keeps the section statuses of the transcode trees, not their contents", () => {
    transcodes(full).forEach((target, index) => {
      const sections = transcodes(slim)[index].tree.children;
      expect(sections.map(({ id, meta }) => ({ id, meta }))).toEqual(
        target.tree.children.map(({ id, meta }) => ({ id, meta })),
      );
      expect(sections.every((section) => section.children === undefined)).toBe(true);
    });
  });

  it("is a small fraction of the document and leaves the input alone", () => {
    const input = golden();
    const size = JSON.stringify(input).length;
    expect(JSON.stringify(slimAnalysis(input)).length).toBeLessThan(size * 0.15);
    expect(JSON.stringify(input).length).toBe(size);
  });
});
