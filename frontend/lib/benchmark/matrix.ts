import type { AbrAlgorithm, StatsSnapshot, StreamingMethod } from "@/types/streaming";
import type { BenchmarkCell, BenchmarkSample, NetworkProfile } from "./types";

/** The adaptive rules under test, plus the fixed-quality control. */
const ALGORITHMS: AbrAlgorithm[] = ["throughput", "buffer", "hybrid", "baseline"];
const PROTOCOLS: StreamingMethod[] = ["hls", "dash"];

/**
 * The cells one sweep measures.
 *
 * Eight adaptive combinations for the protocol/algorithm comparison, plus one progressive HTTP Range
 * cell as the non-adaptive reference the content-characterisation chapter measures against. The
 * source cell carries `baseline` only because the type requires an algorithm — nothing adapts there.
 */
export function buildMatrix(transcodeId: string | null, ladderKind: string): BenchmarkCell[] {
  const cells: BenchmarkCell[] = [];

  for (const protocol of PROTOCOLS) {
    for (const algorithm of ALGORITHMS) {
      cells.push({ transcodeId, ladderKind, protocol, algorithm });
    }
  }

  cells.push({
    transcodeId: null,
    ladderKind: "source",
    protocol: "source",
    algorithm: "baseline",
  });

  return cells;
}

/** Short form for live progress, where the ladder and network are already fixed and on screen. */
export function describeCell(cell: BenchmarkCell): string {
  return cell.protocol === "source"
    ? "source · HTTP Range"
    : `${cell.protocol.toUpperCase()} · ${cell.algorithm}`;
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
