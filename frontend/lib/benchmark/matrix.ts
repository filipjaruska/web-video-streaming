import type { AbrAlgorithm, StatsSnapshot } from "@/types/streaming";
import type { BenchmarkCell, BenchmarkSample, BenchmarkSelection, NetworkProfile } from "./types";

/** The adaptive rules under test, plus the fixed-quality control, in the order they are run. */
export const BENCHMARK_ALGORITHMS: AbrAlgorithm[] = ["throughput", "buffer", "hybrid", "baseline"];
export const BENCHMARK_PROTOCOLS: Array<"hls" | "dash"> = ["hls", "dash"];

/** Repetitions of each cell. Startup and rebuffering are noisy enough that one run proves nothing. */
export const BENCHMARK_REPETITIONS = 3;

/**
 * The cells one sweep measures: every chosen protocol and rule against every chosen ladder, then the
 * progressive HTTP Range cell once, as the non-adaptive reference — it plays the source file, which
 * no ladder changes. The source cell carries `baseline` only because the type requires an
 * algorithm; nothing adapts there. A protocol a ladder was not packaged for is skipped for it.
 */
export function buildMatrix(selection: BenchmarkSelection): BenchmarkCell[] {
  const cells: BenchmarkCell[] = [];

  for (const ladder of selection.ladders) {
    for (const protocol of BENCHMARK_PROTOCOLS) {
      const packaged = protocol === "hls" ? ladder.hasHls : ladder.hasDash;
      if (!selection.protocols.includes(protocol) || !packaged) {
        continue;
      }

      for (const algorithm of BENCHMARK_ALGORITHMS) {
        if (selection.algorithms.includes(algorithm)) {
          cells.push({
            transcodeId: ladder.transcodeId,
            ladderKind: ladder.ladderKind,
            protocol,
            algorithm,
          });
        }
      }
    }
  }

  if (selection.includeSource) {
    cells.push({
      transcodeId: null,
      ladderKind: "source",
      protocol: "source",
      algorithm: "baseline",
    });
  }

  return cells;
}

/**
 * Display name of an algorithm. The fixed-quality control is spelled out because "baseline" alone
 * reads as the source file — it is the ladder's top rung, pinned, while the source file is the
 * separate HTTP Range cell.
 */
export function algorithmLabel(algorithm: string): string {
  return algorithm === "baseline" ? "baseline (top rung)" : algorithm;
}

/** Short form for live progress, where the ladder and network are already fixed and on screen. */
export function describeCell(cell: BenchmarkCell): string {
  return cell.protocol === "source"
    ? "source · HTTP Range"
    : `${cell.protocol.toUpperCase()} · ${algorithmLabel(cell.algorithm)}`;
}

/**
 * Fully qualified identity of a measured configuration, for grouping results.
 *
 * Aggregating on {@link describeCell} alone silently merges runs that differ in the two things the
 * experiment actually varies — the ladder under test and the network it was measured on — so a
 * static-ladder DASH·hybrid row and a dynamic-ladder DASH·hybrid row would average together.
 */
export function describeCellFull(cell: BenchmarkCell, profile: NetworkProfile): string {
  return `${profile}|${cell.ladderKind}|${describeCell(cell)}`;
}

/**
 * Turns the raw per-second snapshots into benchmark samples.
 *
 * `rungIndex` is an ordinal over the distinct heights seen **within this run**, not a ladder index.
 * Switches, oscillations and recovery are all relative comparisons inside one run, so a within-run
 * ordinal is sufficient and avoids depending on a ladder definition the player never reports.
 */
export function toSamples(snapshots: StatsSnapshot[], runStartMs: number): BenchmarkSample[] {
  const heights = Array.from(
    new Set(
      snapshots
        .map((snapshot) => snapshot.quality?.height)
        .filter((height): height is number => typeof height === "number" && height > 0),
    ),
  ).sort((a, b) => a - b);

  return snapshots.map((snapshot) => ({
    atMs: snapshot.timestamp - runStartMs,
    playbackSec: snapshot.playbackTime,
    bufferSec: snapshot.bufferLevel,
    // CurrentStats carries bandwidth in Mbps while every metric works in bits per second.
    bandwidthBps: snapshot.bandwidth * 1_000_000,
    bitrateBps: snapshot.quality?.bitrate ?? 0,
    rungIndex: snapshot.quality?.height ? heights.indexOf(snapshot.quality.height) : -1,
    height: snapshot.quality?.height ?? 0,
    droppedFrames: snapshot.droppedFrames,
    totalFrames: snapshot.totalFrames,
  }));
}
