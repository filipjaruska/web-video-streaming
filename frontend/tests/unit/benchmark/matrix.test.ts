import { describe, expect, it } from "vite-plus/test";

import {
  BENCHMARK_ALGORITHMS,
  buildMatrix,
  describeCell,
  describeCellFull,
  toSamples,
} from "@/lib/benchmark/matrix";
import type { BenchmarkLadder, BenchmarkSelection } from "@/lib/benchmark/types";
import type { StatsSnapshot, VideoQuality } from "@/types/streaming";

const both: BenchmarkLadder = {
  transcodeId: "s",
  ladderKind: "static",
  hasHls: true,
  hasDash: true,
};
const hlsOnly: BenchmarkLadder = {
  transcodeId: "d",
  ladderKind: "dynamic",
  hasHls: true,
  hasDash: false,
};

function selection(overrides: Partial<BenchmarkSelection> = {}): BenchmarkSelection {
  return {
    ladders: [both],
    protocols: ["hls", "dash"],
    algorithms: [...BENCHMARK_ALGORITHMS],
    includeSource: false,
    ...overrides,
  };
}

describe("buildMatrix", () => {
  it("crosses every chosen protocol with every chosen rule for each ladder", () => {
    const cells = buildMatrix(selection());
    expect(cells).toHaveLength(2 * BENCHMARK_ALGORITHMS.length);
    expect(new Set(cells.map((cell) => `${cell.protocol}:${cell.algorithm}`)).size).toBe(
      cells.length,
    );
  });

  it("skips a protocol the ladder was not packaged for", () => {
    const cells = buildMatrix(selection({ ladders: [hlsOnly], algorithms: ["hybrid"] }));
    expect(cells).toEqual([
      { transcodeId: "d", ladderKind: "dynamic", protocol: "hls", algorithm: "hybrid" },
    ]);
  });

  it("adds the source reference once, not per ladder", () => {
    const cells = buildMatrix(
      selection({
        ladders: [both, hlsOnly],
        protocols: ["hls"],
        algorithms: ["buffer"],
        includeSource: true,
      }),
    );
    const source = cells.filter((cell) => cell.protocol === "source");
    expect(source).toEqual([
      { transcodeId: null, ladderKind: "source", protocol: "source", algorithm: "baseline" },
    ]);
    expect(cells.at(-1)).toEqual(source[0]);
  });

  it("is empty when nothing is selected", () => {
    expect(buildMatrix(selection({ protocols: [], includeSource: false }))).toEqual([]);
  });
});

describe("describeCellFull", () => {
  it("keeps ladders and networks apart that describeCell alone would merge", () => {
    const staticCell = {
      transcodeId: "s",
      ladderKind: "static",
      protocol: "dash" as const,
      algorithm: "hybrid" as const,
    };
    const dynamicCell = { ...staticCell, transcodeId: "d", ladderKind: "dynamic" };

    expect(describeCell(staticCell)).toBe(describeCell(dynamicCell));
    expect(describeCellFull(staticCell, "fourG")).not.toBe(describeCellFull(dynamicCell, "fourG"));
    expect(describeCellFull(staticCell, "fourG")).not.toBe(describeCellFull(staticCell, "threeG"));
  });
});

describe("toSamples", () => {
  const quality = (height: number, bitrate: number): VideoQuality => ({
    width: Math.round((height * 16) / 9),
    height,
    bitrate,
    label: `${height}p`,
  });

  const snapshot = (timestamp: number, q: VideoQuality | null): StatsSnapshot => ({
    timestamp,
    quality: q,
    bufferLevel: 4,
    bandwidth: 2.5,
    droppedFrames: 0,
    totalFrames: 24,
    playbackTime: timestamp / 1000,
  });

  it("orders the run's levels by bitrate and counts two rungs of one height apart", () => {
    const samples = toSamples(
      [
        snapshot(1000, quality(720, 4_500_000)),
        snapshot(2000, quality(540, 2_000_000)),
        snapshot(3000, quality(720, 1_500_000)),
      ],
      1000,
    );
    // 720p@1.5M < 540p@2M < 720p@4.5M: the ordinal follows bitrate, not height.
    expect(samples.map((sample) => sample.rungIndex)).toEqual([2, 1, 0]);
  });

  it("converts the time base and the Mb/s bandwidth into the units the metrics use", () => {
    const [sample] = toSamples([snapshot(5000, quality(360, 800_000))], 2000);
    expect(sample.atMs).toBe(3000);
    expect(sample.bandwidthBps).toBe(2_500_000);
    expect(sample.bitrateBps).toBe(800_000);
    expect(sample.height).toBe(360);
  });

  it("marks samples without a known rendition as unknown rather than as the bottom rung", () => {
    const samples = toSamples([snapshot(1000, null), snapshot(2000, quality(360, 800_000))], 0);
    expect(samples[0].rungIndex).toBe(-1);
    expect(samples[0].height).toBe(0);
    expect(samples[1].rungIndex).toBe(0);
  });
});
