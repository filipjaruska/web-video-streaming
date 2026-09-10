"use client";

import { useCallback, useRef, useState } from "react";
import type { PlaybackEvent, StatsSnapshot } from "@/types/streaming";
import type { VideoPlayerHandle } from "@/components/video-player";
import { computeMetrics } from "@/lib/benchmark/metrics";
import { buildMatrix, describeCell, toSamples } from "@/lib/benchmark/matrix";
import {
  toServerProfile,
  type BenchmarkCell,
  type BenchmarkEvent,
  type BenchmarkRunResult,
  type NetworkProfile,
} from "@/lib/benchmark/types";

/** Repetitions of each cell. Startup and rebuffering are noisy enough that one run proves nothing. */
const REPETITIONS = 3;

/** How long to keep retrying `play()` before declaring the cell unplayable. */
const START_TIMEOUT_MS = 20_000;

/** Multiplier on clip duration before a run is abandoned, covering heavy rebuffering. */
const RUN_TIMEOUT_FACTOR = 3;
const RUN_TIMEOUT_FLOOR_MS = 60_000;

interface UseBenchmarkRunnerProps {
  routeId: string;
  apiUrl: string;
  playerRef: React.RefObject<VideoPlayerHandle | null>;
  /** Applies a cell to the player, and bumps the nonce so an identical cell still remounts. */
  applyCell: (cell: BenchmarkCell, nonce: number) => void;
  getSnapshots: () => StatsSnapshot[];
  resetStats: () => void;
}

export interface BenchmarkProgress {
  running: boolean;
  cellLabel: string;
  cellIndex: number;
  cellCount: number;
  repetition: number;
  repetitions: number;
}

const IDLE: BenchmarkProgress = {
  running: false,
  cellLabel: "",
  cellIndex: 0,
  cellCount: 0,
  repetition: 0,
  repetitions: REPETITIONS,
};

export function useBenchmarkRunner({
  routeId,
  apiUrl,
  playerRef,
  applyCell,
  getSnapshots,
  resetStats,
}: UseBenchmarkRunnerProps) {
  const [progress, setProgress] = useState<BenchmarkProgress>(IDLE);
  const [results, setResults] = useState<BenchmarkRunResult[]>([]);

  const eventsRef = useRef<BenchmarkEvent[]>([]);
  const runStartRef = useRef(0);
  /**
   * The same instant as `runStartRef`, on the wall clock.
   *
   * Events are timed with `performance.now()` while snapshots carry `Date.now()`, so rebasing the
   * two onto a common origin needs both readings taken together. Inferring one from the other after
   * the fact drifts by however long harvesting took.
   */
  const runStartWallRef = useRef(0);
  const cancelRef = useRef(false);
  const nonceRef = useRef(0);

  /**
   * Feeds player lifecycle edges into the run currently being recorded.
   *
   * Wired into `VideoPlayer.onPlaybackEvent` by the parent. Timestamps are rebased onto the run so
   * a trace is readable on its own, without needing to know when the sweep began.
   */
  const handlePlaybackEvent = useCallback((event: PlaybackEvent) => {
    if (runStartRef.current === 0) {
      return;
    }

    const atMs = event.atMs - runStartRef.current;
    if (event.kind === "error") {
      eventsRef.current.push({ kind: "error", atMs, message: event.message ?? "playback error" });
      return;
    }

    eventsRef.current.push({ kind: event.kind, atMs });
  }, []);

  /** Records that the operator switched clumsy to a different profile, for the variable-network run. */
  const markNetworkTransition = useCallback((profile: NetworkProfile) => {
    if (runStartRef.current === 0) {
      return;
    }

    eventsRef.current.push({
      kind: "networkTransition",
      atMs: performance.now() - runStartRef.current,
      profile,
    });
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const runOne = useCallback(
    async (
      cell: BenchmarkCell,
      profile: NetworkProfile,
      repetition: number,
    ): Promise<BenchmarkRunResult> => {
      eventsRef.current = [];
      runStartRef.current = 0;

      nonceRef.current += 1;
      applyCell(cell, nonceRef.current);

      // The player is remounted by the nonce, so give React a beat to tear down and re-attach
      // before asking the fresh instance to play.
      await delay(600);
      resetStats();
      runStartRef.current = performance.now();
      runStartWallRef.current = Date.now();

      // Adaptive sources defer loading until playback is requested, and the handle may not be
      // attached the instant the nonce changes, so play() is retried until the first frame lands.
      const startedAt = performance.now();
      let started = false;
      while (!started && performance.now() - startedAt < START_TIMEOUT_MS) {
        if (cancelRef.current) break;
        try {
          await playerRef.current?.play();
        } catch {
          // Autoplay rejection or a not-yet-ready provider; retried below.
        }

        started = eventsRef.current.some((event) => event.kind === "startup");
        if (!started) await delay(400);
      }

      const failed = (message: string): BenchmarkRunResult => ({
        cell,
        networkProfile: profile,
        repetition,
        metrics: computeMetrics({ samples: [], events: eventsRef.current, durationMs: 0 }),
        trace: { samples: [], events: eventsRef.current, durationMs: 0 },
        failed: true,
        errorMessage: message,
      });

      if (!started) {
        playerRef.current?.pause();
        runStartRef.current = 0;
        return failed("playback never started");
      }

      const duration = playerRef.current?.getDuration() ?? null;
      const timeoutMs = Math.max(
        RUN_TIMEOUT_FLOOR_MS,
        (duration ?? 60) * 1000 * RUN_TIMEOUT_FACTOR,
      );

      const endedAt = await waitForEnd(eventsRef, timeoutMs, cancelRef);
      playerRef.current?.pause();

      const durationMs = endedAt ?? performance.now() - runStartRef.current;
      const samples = toSamples(getSnapshots(), runStartWallRef.current);
      const events = [...eventsRef.current];
      runStartRef.current = 0;

      const errored = events.find((event) => event.kind === "error");
      const trace = { samples, events, durationMs };

      return {
        cell,
        networkProfile: profile,
        repetition,
        metrics: computeMetrics(trace),
        trace,
        failed: !!errored,
        errorMessage: errored && "message" in errored ? errored.message : undefined,
      };
    },
    [applyCell, getSnapshots, playerRef, resetStats],
  );

  const submit = useCallback(
    async (result: BenchmarkRunResult) => {
      try {
        await fetch(`${apiUrl}/api/benchmarks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeId,
            transcodeId: result.cell.transcodeId,
            mode: result.networkProfile === "variable" ? "VariableNetwork" : "Matrix",
            networkProfile: toServerProfile(result.networkProfile),
            ladderKind: result.cell.ladderKind,
            protocol: result.cell.protocol,
            abrAlgorithm: result.cell.algorithm,
            repetition: result.repetition,
            ...result.metrics,
            failed: result.failed,
            errorMessage: result.errorMessage,
            trace: result.trace,
          }),
        });
      } catch {
        // A failed upload must not abort the sweep — the result is still held in local state and
        // can be exported to CSV, which is what the thesis tables are built from anyway.
      }
    },
    [apiUrl, routeId],
  );

  const start = useCallback(
    async (
      transcodeId: string | null,
      ladderKind: string,
      profile: NetworkProfile,
      cells?: BenchmarkCell[],
    ) => {
      cancelRef.current = false;
      setResults([]);

      const matrix = cells ?? buildMatrix(transcodeId, ladderKind);
      const collected: BenchmarkRunResult[] = [];

      for (let index = 0; index < matrix.length; index++) {
        for (let repetition = 1; repetition <= REPETITIONS; repetition++) {
          if (cancelRef.current) {
            setProgress(IDLE);
            return collected;
          }

          setProgress({
            running: true,
            cellLabel: describeCell(matrix[index]),
            cellIndex: index + 1,
            cellCount: matrix.length,
            repetition,
            repetitions: REPETITIONS,
          });

          const result = await runOne(matrix[index], profile, repetition);
          collected.push(result);
          setResults([...collected]);
          await submit(result);
        }
      }

      setProgress(IDLE);
      return collected;
    },
    [runOne, submit],
  );

  return { progress, results, start, cancel, handlePlaybackEvent, markNetworkTransition };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


/** Resolves with the run length once playback ends, or null if it timed out or was cancelled. */
async function waitForEnd(
  eventsRef: React.RefObject<BenchmarkEvent[]>,
  timeoutMs: number,
  cancelRef: React.RefObject<boolean>,
): Promise<number | null> {
  const startedAt = performance.now();

  while (performance.now() - startedAt < timeoutMs) {
    if (cancelRef.current) {
      return null;
    }

    const ended = eventsRef.current.find((event) => event.kind === "ended");
    if (ended) {
      return ended.atMs;
    }

    await delay(250);
  }

  return null;
}
