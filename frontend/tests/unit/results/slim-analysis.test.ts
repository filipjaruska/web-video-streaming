import { describe, expect, it } from "vite-plus/test";

import { collectVmafEntries, pickPreviewRung, pickStaticTranscode } from "@/lib/analysisTargets";
import { slimAnalysis } from "@/lib/results/slimAnalysis";
import type {
  AnalysisTarget,
  AnalysisTreeDocument,
  VideoAnalysisResponse,
  VmafSeriesData,
} from "@/lib/videoAnalysisApi";

/** Frames in a 30 s clip at 25 fps, the length the per-frame series have in practice. */
const FRAMES = 750;
const RUNGS = ["1080p", "720p", "540p", "432p", "360p", "234p"];

const series = (offset: number) =>
  Array.from({ length: FRAMES }, (_, frame) => offset + frame / 10);
const times = Array.from({ length: FRAMES }, (_, frame) => frame / 25);

function rung(index: number): VmafSeriesData {
  const summary = { mean: 95 - index, harmonicMean: 94 - index, min: 80 - index, max: 99 };
  return {
    scores: series(index),
    timeSec: times,
    summary: { ...summary, bitrateBps: 8_000_000 / (index + 1), cambi: index / 2 },
    summaryByModel: { vmaf: summary, neg: { ...summary, harmonicMean: 93 - index } },
  };
}

function tree(id: string): AnalysisTreeDocument {
  return {
    id,
    label: id,
    children: ["hls", "dash"].map((format) => ({
      id: format,
      label: format.toUpperCase(),
      meta: { kind: "section", status: "completed" },
      children: RUNGS.map((label) => ({ id: `${format}-${label}`, label, value: "measured" })),
    })),
  };
}

function transcode(ladderKind: "static" | "dynamic" | "animation"): AnalysisTarget {
  const byFormat = <T>(make: (index: number) => T) =>
    Object.fromEntries(RUNGS.map((label, index) => [label, make(index)]));
  return {
    id: `transcode:${ladderKind}`,
    label: ladderKind,
    kind: "transcode",
    status: "completed",
    transcodeId: ladderKind,
    ladderKind,
    tree: tree(ladderKind),
    series: {
      vmafByFormat: { hls: byFormat(rung), dash: byFormat(rung) },
      sitiByFormat: {
        hls: byFormat((index) => ({ si: series(index), ti: series(index + 1), timeSec: times })),
        dash: byFormat((index) => ({ si: series(index), ti: series(index + 1), timeSec: times })),
      },
      packagingIntegrity: { rungs: [] } as never,
      ...(ladderKind === "static"
        ? {
            encodeGrid: [{ height: 1080, crf: 23, bitrateBps: 4_000_000, vmafMean: 93 }] as never,
            encodeGridAnimation: [] as never,
            derivedLadder: { rungs: [] } as never,
            animationLadder: { rungs: [] } as never,
            ladderComparison: { ladders: [] } as never,
            tuningComparison: { pairs: [] } as never,
          }
        : {}),
    },
  };
}

/** An analysis document of the shape the backend returns: the source and three packaging runs. */
function analysis(): VideoAnalysisResponse {
  return {
    routeId: "abc123",
    schemaVersion: 1,
    updatedAtUtc: "2026-10-27T00:00:00Z",
    targets: [
      {
        id: "source",
        label: "Source",
        kind: "source",
        status: "completed",
        tree: tree("source"),
        series: {
          siti: { si: series(0), ti: series(1), timeSec: times },
          duplicateFrameShare: 0.4,
          stageTimings: { StaticEncode: { totalMs: 1000, count: 1 } } as never,
        },
      },
      transcode("static"),
      transcode("dynamic"),
      transcode("animation"),
    ],
  };
}

describe("slimAnalysis", () => {
  const full = analysis();
  const slim = slimAnalysis(analysis());
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
      "ladderComparison",
      "tuningComparison",
    ] as const) {
      expect(after[field], field).toEqual(before[field]);
    }
    expect(after.packagingIntegrity).toBeUndefined();
  });

  it("keeps every rung's VMAF summary but drops the per-frame scores", () => {
    expect(transcodes(slim)).toHaveLength(3);
    transcodes(full).forEach((target, index) => {
      const before = collectVmafEntries(target.series.vmafByFormat);
      const after = collectVmafEntries(transcodes(slim)[index].series.vmafByFormat);
      expect(before).toHaveLength(RUNGS.length * 2);
      expect(after.map(({ format, label }) => `${format}/${label}`)).toEqual(
        before.map(({ format, label }) => `${format}/${label}`),
      );
      after.forEach((entry, rungIndex) => {
        expect(entry.data.scores).toEqual([]);
        expect(entry.data.timeSec).toBeUndefined();
        expect(entry.data.summary).toEqual(before[rungIndex].data.summary);
        expect(entry.data.summaryByModel).toEqual(before[rungIndex].data.summaryByModel);
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
    const input = analysis();
    const size = JSON.stringify(input).length;
    expect(JSON.stringify(slimAnalysis(input)).length).toBeLessThan(size * 0.15);
    expect(JSON.stringify(input).length).toBe(size);
  });
});
