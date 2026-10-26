import { describe, expect, it } from "vite-plus/test";

import type { BenchmarkSample } from "@/lib/benchmark/types";
import {
  buildChapter5,
  contentRows,
  ladderPlaybackRows,
  ladderRows,
  overheadRows,
  populationStdDev,
  progressiveRows,
  protocolRows,
  tuningByCrf,
  variableRows,
  type VideoData,
} from "@/lib/results/chapter5";
import type { AnalysisTarget, VideoAnalysisResponse } from "@/lib/videoAnalysisApi";
import type {
  BenchmarkAggregateDto,
  BenchmarkTraceDto,
  VideoBenchmarksResponse,
} from "@/lib/videoBenchmarksApi";

/*
 * Hand-built videos whose expected figures can be worked out on paper. The definitions pinned here
 * are the thesis's: population SD for SI/TI, both protocols averaged for Tables 10 and 11, steady
 * state from the end of the first 6 s segment, overhead as multiples of the static encode.
 */

const tree = { id: "root", label: "root", children: [] };

function source(series: AnalysisTarget["series"]): AnalysisTarget {
  return { id: "source", label: "Source", kind: "source", status: "completed", tree, series };
}

function transcode(
  ladderKind: "static" | "dynamic" | "animation",
  series: AnalysisTarget["series"],
): AnalysisTarget {
  return {
    id: `t-${ladderKind}`,
    label: ladderKind,
    kind: "transcode",
    status: "completed",
    transcodeId: `${ladderKind}-id`,
    ladderKind,
    tree,
    series,
  };
}

function analysis(targets: AnalysisTarget[]): VideoAnalysisResponse {
  return { routeId: "r", schemaVersion: 1, updatedAtUtc: null, targets };
}

function aggregate(overrides: Partial<BenchmarkAggregateDto>): BenchmarkAggregateDto {
  return {
    networkProfile: "Standard",
    ladderKind: "static",
    protocol: "hls",
    abrAlgorithm: "throughput",
    runs: 3,
    startupMsMean: 500,
    startupMsStdDev: 0,
    bufferingRatioMean: 0,
    bufferingRatioStdDev: 0,
    qualitySwitchesMean: 0,
    oscillationsMean: 0,
    timeWeightedBitrateBpsMean: 4_000_000,
    rebufferMsMean: 0,
    rebufferCountMean: 0,
    ...overrides,
  };
}

function video(overrides: Partial<VideoData>): VideoData {
  return {
    routeId: "r",
    title: "Video",
    analysis: null,
    benchmarks: null,
    traces: null,
    ...overrides,
  };
}

function benchmarks(
  aggregates: BenchmarkAggregateDto[],
  runs = 0,
  failed = 0,
): VideoBenchmarksResponse {
  return {
    routeId: "r",
    schemaVersion: 1,
    aggregates,
    runs: Array.from({ length: runs }, (_, index) => ({
      id: `${index}`,
      mode: "Matrix",
      networkProfile: "Standard",
      ladderKind: "static",
      protocol: "hls",
      abrAlgorithm: "throughput",
      repetition: 1,
      bufferingRatio: 0,
      rebufferCount: 0,
      rebufferMs: 0,
      qualitySwitches: 0,
      oscillations: 0,
      timeWeightedBitrateBps: 0,
      droppedFrameRatio: 0,
      failed: index < failed,
      createdAtUtc: "2026-01-01T00:00:00Z",
    })),
  };
}

describe("content characteristics", () => {
  it("uses the population standard deviation over every frame", () => {
    expect(populationStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 9);
    const [row] = contentRows([
      video({
        analysis: analysis([
          source({
            siti: { si: [10, 20, 30], ti: [0, 4] },
            duplicateFrameShare: 0.4,
            sourceCambi: 0.1,
          }),
        ]),
      }),
    ]);
    expect(row).toMatchObject({ siMean: 20, tiMean: 2, tiStdDev: 2, duplicateFrameShare: 0.4 });
    expect(row.siStdDev).toBeCloseTo(Math.sqrt(200 / 3), 9);
  });

  it("reads progressive playback from the source cells, per profile", () => {
    const [row] = progressiveRows([
      video({
        benchmarks: benchmarks([
          aggregate({
            protocol: "source",
            ladderKind: "source",
            abrAlgorithm: "baseline",
            networkProfile: "ThreeG",
            startupMsMean: 3562,
            bufferingRatioMean: 0.928,
          }),
          aggregate({ protocol: "hls", networkProfile: "ThreeG", startupMsMean: 1 }),
        ]),
      }),
    ]);
    expect(row.byProfile.threeG).toEqual({ startupMs: 3562, bufferingRatio: 0.928, runs: 3 });
    expect(row.byProfile.fourG).toBeNull();
  });
});

describe("ladder comparison", () => {
  const point = { label: "x", bitrateBps: 1, vmafHarmonicMean: 1, vmafMean: 1 };
  const comparison = {
    staticPoints: [point, point, point, point, point, point],
    ladders: [
      {
        ladderKind: "dynamic",
        label: "d",
        bdRatePercent: -6.24,
        bdRateHighBandPercent: -12.92,
        bdVmaf: 1.53,
        overlapLowVmaf: 0,
        overlapHighVmaf: 0,
        points: [point, point, point, point, point, point, point],
      },
      {
        ladderKind: "animation",
        label: "a",
        bdRatePercent: 999,
        overlapLowVmaf: 0,
        overlapHighVmaf: 0,
        points: [point],
        error: "no overlap",
      },
    ],
  };

  it("counts rungs per ladder and blanks the figures of a failed comparison", () => {
    const [row] = ladderRows([
      video({ analysis: analysis([transcode("static", { ladderComparison: comparison })]) }),
    ]);
    expect(row.rungs).toEqual({ static: 6, dynamic: 7, animation: 1 });
    expect(row.ladders.dynamic).toEqual({
      bdRate: -6.24,
      bdRateHighBand: -12.92,
      bdVmaf: 1.53,
      error: null,
    });
    expect(row.ladders.animation).toEqual({
      bdRate: null,
      bdRateHighBand: null,
      bdVmaf: null,
      error: "no overlap",
    });
  });
});

describe("codec tuning by CRF", () => {
  const pair = (height: number, crf: number, vmafDelta: number, cambi: [number, number]) => ({
    label: `${height}p`,
    height,
    crf,
    baseVmaf: 90,
    tunedVmaf: 90 + vmafDelta,
    vmafDelta,
    baseCambi: cambi[0],
    tunedCambi: cambi[1],
    baseBitrateBps: 1,
    tunedBitrateBps: 1,
  });

  it("averages over resolutions, keeping only CRFs every resolution was encoded at", () => {
    const pairs = [
      pair(1080, 20, 0.2, [1, 3]),
      pair(720, 20, 0.4, [1, 2]),
      pair(1080, 24, 0.5, [1, 1]),
      // 720p is missing at CRF 24, so that CRF would average a different set and is dropped.
      pair(720, 22, 9, [0, 0]),
    ];
    const [series] = tuningByCrf([
      video({
        analysis: analysis([transcode("static", { tuningComparison: { decimate: false, pairs } })]),
      }),
    ]);
    expect(series.points).toHaveLength(1);
    expect(series.points[0].crf).toBe(20);
    expect(series.points[0].vmafDelta).toBeCloseTo(0.3, 9);
    expect(series.points[0].cambiDelta).toBeCloseTo(1.5, 9);
  });
});

describe("computational overhead", () => {
  const timing = (durationMs: number, count?: number) => ({ durationMs, count });

  it("expresses each phase as a multiple of the static encode and package", () => {
    const [row] = overheadRows([
      video({
        analysis: analysis([
          source({
            stageTimings: {
              StaticEncode: timing(900),
              StaticPackage: timing(100),
              EncodeGrid: timing(24_680, 51),
              AnimationGrid: timing(24_290, 51),
              AnimationDeriveLadder: timing(0),
              AnimationEncode: timing(700),
              AnimationPackage: timing(80),
            },
          }),
        ]),
      }),
    ]);
    expect(row).toMatchObject({
      samplesDefault: 51,
      samplesTuned: 51,
      defaultGrid: 24.68,
      tunedGrid: 24.29,
    });
    expect(row.ladderEncode).toBeCloseTo(0.78, 9);
    expect(row.productionPath).toBeCloseTo(49.75, 9);
  });

  it("is empty without stage timings", () => {
    expect(
      overheadRows([video({ analysis: analysis([source({})]) })])[0].productionPath,
    ).toBeNull();
  });
});

describe("protocols and ladders in playback", () => {
  // Two rungs, so the delivered quality follows which one was on screen.
  const vmafByFormat = (low: number, high: number) => ({
    hls: {
      "360p": {
        scores: [],
        summary: { mean: low, harmonicMean: low, min: low, max: low, height: 360 },
      },
      "1080p": {
        scores: [],
        summary: { mean: high, harmonicMean: high, min: high, max: high, height: 1080 },
      },
    },
  });

  const sample = (playbackSec: number, height: number): BenchmarkSample => ({
    atMs: 1000 + playbackSec * 1000,
    playbackSec,
    bufferSec: 6,
    bandwidthBps: 1,
    bitrateBps: 1,
    rungIndex: height === 1080 ? 1 : 0,
    height,
    droppedFrames: 0,
    totalFrames: 1,
  });

  // First segment on 360p, then 1080p: whole session and steady state differ.
  const trace = (ladder: string, protocol: string): BenchmarkTraceDto => ({
    id: `${ladder}-${protocol}`,
    transcodeId: `${ladder}-id`,
    networkProfile: "FourG",
    ladderKind: ladder,
    protocol,
    abrAlgorithm: "throughput",
    repetition: 1,
    failed: false,
    trace: {
      samples: [0, 2, 4, 6, 8, 10].map((s) => sample(s, s < 6 ? 360 : 1080)),
      events: [{ kind: "startup", atMs: 1000 }],
      durationMs: 13_000,
    },
  });

  const data = video({
    analysis: analysis([
      transcode("static", { vmafByFormat: vmafByFormat(40, 96) }),
      transcode("animation", { vmafByFormat: vmafByFormat(60, 94) }),
    ]),
    benchmarks: benchmarks([
      aggregate({
        networkProfile: "FourG",
        protocol: "hls",
        timeWeightedVmafMean: 80,
        timeWeightedBitrateBpsMean: 8e6,
      }),
      aggregate({
        networkProfile: "FourG",
        protocol: "dash",
        timeWeightedVmafMean: 79,
        timeWeightedBitrateBpsMean: 8e6,
      }),
      aggregate({
        networkProfile: "FourG",
        ladderKind: "animation",
        protocol: "hls",
        timeWeightedVmafMean: 82,
        timeWeightedBitrateBpsMean: 2e6,
      }),
      aggregate({
        networkProfile: "FourG",
        ladderKind: "animation",
        protocol: "dash",
        timeWeightedVmafMean: 81,
        timeWeightedBitrateBpsMean: 2e6,
      }),
      aggregate({
        networkProfile: "Variable",
        ladderKind: "dynamic",
        protocol: "dash",
        rebufferMsMean: 8800,
        bufferingRatioMean: 0.223,
      }),
    ]),
    traces: {
      routeId: "r",
      schemaVersion: 1,
      runs: [
        trace("static", "hls"),
        trace("static", "dash"),
        trace("animation", "hls"),
        trace("animation", "dash"),
      ],
    },
  });

  it("subtracts DASH from HLS per ladder and profile", () => {
    const staticRow = protocolRows([data]).find((row) => row.ladder === "static");
    expect(staticRow?.byProfile.fourG.throughput).toBeCloseTo(1, 9);
    expect(staticRow?.byProfile.fourG.hybrid).toBeNull();
  });

  it("compares the ladders over both protocols, whole session and steady state", () => {
    const row = ladderPlaybackRows([data]).find((item) => item.profile === "fourG");
    expect(row?.byRule.throughput.wholeDelta).toBeCloseTo(81.5 - 79.5, 9);
    expect(row?.byRule.throughput.saving).toBeCloseTo(75, 9);
    // After the first segment only the 1080p rungs count: 94 − 96.
    expect(row?.byRule.throughput.steadyDelta).toBeCloseTo(-2, 9);
  });

  it("reports stalls of the variable network in seconds, per protocol", () => {
    const row = variableRows([data]).find((item) => item.ladder === "dynamic");
    expect(row?.throughput.stallSec).toEqual({ hls: null, dash: 8.8 });
    expect(row?.throughput.bufferingPercent.dash).toBeCloseTo(22.3, 9);
  });
});

describe("the whole chapter", () => {
  it("orders videos by title and counts every run, failed ones included", () => {
    const report = buildChapter5([
      video({ routeId: "b", title: "Violet", benchmarks: benchmarks([], 4, 1) }),
      video({ routeId: "a", title: "Frieren", benchmarks: benchmarks([], 2) }),
    ]);
    expect(report.videos.map((item) => item.title)).toEqual(["Frieren", "Violet"]);
    expect(report.runs).toEqual({ total: 6, failed: 1 });
    expect(report.videos.every((item) => !item.complete)).toBe(true);
  });
});
