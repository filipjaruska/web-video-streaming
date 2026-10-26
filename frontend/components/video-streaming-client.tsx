"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StreamingMethod, AbrAlgorithm, PlaybackEvent } from "@/types/streaming";
import { SOURCE_RUN_ID, isSourceRun } from "@/types/streaming";
import { StreamingControls } from "@/components/streaming-controls";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video-player";
import { BenchmarkPanel, BenchmarkSessionResults } from "@/components/benchmark-panel";
import { useBenchmarkRunner } from "@/hooks/useBenchmarkRunner";
import { usePlaybackCapabilities } from "@/hooks/usePlaybackCapabilities";
import type { BenchmarkLadder } from "@/lib/benchmark/types";
import { PlaybackStats } from "@/components/playback-stats";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useVideoStats } from "@/hooks/useVideoStats";
import { useVideoSubtitles } from "@/hooks/useVideoSubtitles";
import { useVideoTranscodes } from "@/hooks/useVideoTranscodes";
import { pickBestPlaybackSettings } from "@/lib/videoTranscodesApi";
import { getPublicApiUrl } from "@/lib/env";

interface VideoStreamingClientProps {
  routeId: string;
  /** Watch: player and stream settings. Benchmark: the runner above the player. */
  mode: "watch" | "benchmark";
  /** Keep the ladder list fresh: the video is still being processed. */
  poll?: boolean;
}

function deliveryForLadder(
  hasHls: boolean,
  hasDash: boolean,
  preferred?: StreamingMethod,
): "hls" | "dash" | null {
  if (preferred === "hls" && hasHls) return "hls";
  if (preferred === "dash" && hasDash) return "dash";
  if (hasHls) return "hls";
  if (hasDash) return "dash";
  return null;
}

export function VideoStreamingClient({ routeId, mode, poll = false }: VideoStreamingClientProps) {
  const apiUrl = getPublicApiUrl();
  const {
    transcodes,
    activeTranscodeId,
    loading: transcodesLoading,
  } = useVideoTranscodes(routeId, { poll });
  const { tracks: subtitleTracks } = useVideoSubtitles(routeId);

  const [bestMode, setBestMode] = useState(true);
  const [streamingMethod, setStreamingMethod] = useState<StreamingMethod>("source");
  const [abrAlgorithm, setAbrAlgorithm] = useState<AbrAlgorithm>("hybrid");
  const [packagingRunId, setPackagingRunId] = useState<string | null>(null);
  const [runNonce, setRunNonce] = useState(0);
  const { stats, updateStats, resetStats, recordRebuffer, getSnapshots } = useVideoStats();
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  const {
    progress: benchmarkProgress,
    results: benchmarkResults,
    start: startBenchmark,
    cancel: cancelBenchmark,
    handlePlaybackEvent,
    networkProfileNow,
  } = useBenchmarkRunner({
    routeId,
    apiUrl,
    playerRef,
    // The sweep drives the same setters the selectors do, and bumps the nonce so repeating an
    // identical configuration still remounts the player instead of reusing a warm buffer.
    applyCell: useCallback((cell, nonce) => {
      setPackagingRunId(cell.transcodeId ?? SOURCE_RUN_ID);
      setStreamingMethod(cell.protocol);
      setAbrAlgorithm(cell.algorithm);
      setRunNonce(nonce);
    }, []),
    getSnapshots,
    resetStats,
  });

  /**
   * Feeds stalls into the live tiles as well as the benchmark.
   *
   * Rebuffer duration had no producer at all before this, so the statistics card could only ever
   * show zero however badly playback stuttered.
   */
  const stallStartedRef = useRef<number | null>(null);
  const onPlaybackEvent = useCallback(
    (event: PlaybackEvent) => {
      if (event.kind === "rebufferStart") {
        stallStartedRef.current = event.atMs;
      } else if (event.kind === "rebufferEnd" && stallStartedRef.current !== null) {
        recordRebuffer((event.atMs - stallStartedRef.current) / 1000);
        stallStartedRef.current = null;
      }

      handlePlaybackEvent(event);
    },
    [handlePlaybackEvent, recordRebuffer],
  );

  /** Every packaged ladder a sweep can choose from: static first, then the two derived ones. */
  const benchmarkLadders = useMemo<BenchmarkLadder[]>(() => {
    const order = ["static", "dynamic", "animation"];
    const rank = (kind: string) => {
      const position = order.indexOf(kind);
      return position < 0 ? order.length : position;
    };

    return transcodes
      .filter((item) => item.status === "succeeded" && (item.hasHls || item.hasDash))
      .toSorted((a, b) => rank(a.ladderKind) - rank(b.ladderKind))
      .map((item) => ({
        transcodeId: item.id,
        ladderKind: item.ladderKind,
        hasHls: item.hasHls,
        hasDash: item.hasDash,
      }));
  }, [transcodes]);

  const capabilities = usePlaybackCapabilities();

  const bestSettings = useMemo(() => {
    if (transcodesLoading) return null;
    return pickBestPlaybackSettings(transcodes, activeTranscodeId, capabilities);
  }, [transcodes, activeTranscodeId, transcodesLoading, capabilities]);

  // Keep manual state in sync with Best so unlocking starts from the auto pick.
  useEffect(() => {
    if (!bestMode || !bestSettings) return;
    setPackagingRunId((prev) =>
      prev === bestSettings.packagingRunId ? prev : bestSettings.packagingRunId,
    );
    setStreamingMethod((prev) =>
      prev === bestSettings.streamingMethod ? prev : bestSettings.streamingMethod,
    );
    setAbrAlgorithm((prev) =>
      prev === bestSettings.abrAlgorithm ? prev : bestSettings.abrAlgorithm,
    );
  }, [bestMode, bestSettings]);

  // Keep delivery valid when packaging run changes in manual mode.
  useEffect(() => {
    if (bestMode || !packagingRunId) return;

    if (isSourceRun(packagingRunId)) {
      if (streamingMethod !== "source") {
        setStreamingMethod("source");
      }
      return;
    }

    const selected = transcodes.find((item) => item.id === packagingRunId);
    if (!selected) return;

    if (streamingMethod === "source") {
      const next = deliveryForLadder(selected.hasHls, selected.hasDash);
      if (next) {
        setStreamingMethod(next);
      } else {
        setPackagingRunId(SOURCE_RUN_ID);
        setStreamingMethod("source");
      }
      return;
    }

    if (streamingMethod === "dash" && !selected.hasDash) {
      const next = deliveryForLadder(selected.hasHls, selected.hasDash, "hls");
      if (next) setStreamingMethod(next);
      else {
        setPackagingRunId(SOURCE_RUN_ID);
        setStreamingMethod("source");
      }
    } else if (streamingMethod === "hls" && !selected.hasHls) {
      const next = deliveryForLadder(selected.hasHls, selected.hasDash, "dash");
      if (next) setStreamingMethod(next);
      else {
        setPackagingRunId(SOURCE_RUN_ID);
        setStreamingMethod("source");
      }
    }
  }, [bestMode, packagingRunId, transcodes, streamingMethod]);

  const effectiveMethod = bestMode && bestSettings ? bestSettings.streamingMethod : streamingMethod;
  const effectiveAbr = bestMode && bestSettings ? bestSettings.abrAlgorithm : abrAlgorithm;
  const effectivePackagingRunId =
    bestMode && bestSettings ? bestSettings.packagingRunId : packagingRunId;

  useEffect(() => {
    resetStats();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the stream selection is the trigger: a new protocol, ABR or packaging run starts fresh stats
  }, [effectiveMethod, effectiveAbr, effectivePackagingRunId, resetStats]);

  // Don't mount until Best can resolve (avoids source → DASH remount races).
  const playerReady = !bestMode || bestSettings !== null;

  function handleBestModeChange(enabled: boolean) {
    setBestMode(enabled);
    if (enabled && bestSettings) {
      setPackagingRunId(bestSettings.packagingRunId);
      setStreamingMethod(bestSettings.streamingMethod);
      setAbrAlgorithm(bestSettings.abrAlgorithm);
    }
  }

  function handlePackagingRunChange(nextId: string) {
    setPackagingRunId(nextId);

    if (isSourceRun(nextId)) {
      setStreamingMethod("source");
      return;
    }

    const selected = transcodes.find((item) => item.id === nextId);
    if (!selected) return;

    const next = deliveryForLadder(
      selected.hasHls,
      selected.hasDash,
      streamingMethod === "source" ? undefined : streamingMethod,
    );
    if (next) {
      setStreamingMethod(next);
    } else {
      setPackagingRunId(SOURCE_RUN_ID);
      setStreamingMethod("source");
    }
  }

  /**
   * Retries the other protocol when a provider fails outright.
   *
   * Four guards, each load-bearing:
   *  1. Never during a benchmark sweep. A transient error mid-cell would silently change protocol
   *     and the recorded row would be labelled with a protocol it did not actually use.
   *  2. Never in manual mode. If a viewer explicitly selects DASH and DASH fails, the error is the
   *     finding — swapping it away hides exactly what this app exists to surface.
   *  3. Nothing to fall back to from the progressive source.
   *  4. One attempt per run and protocol. `MediaPlayer` fires `onError` repeatedly, so without
   *     this the two protocols would ping-pong.
   */
  const attemptedFallbackRef = useRef<Set<string>>(new Set());
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);

  useEffect(() => {
    attemptedFallbackRef.current.clear();
    setFallbackNotice(null);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a new video or packaging run is the trigger: fallbacks tried for the old one no longer apply
  }, [routeId, effectivePackagingRunId]);

  const handleFatalError = useCallback(
    ({ method }: { method: StreamingMethod; message: string }) => {
      if (benchmarkProgress.running) return;
      if (!bestMode) return;
      if (method === "source") return;

      const key = `${effectivePackagingRunId ?? SOURCE_RUN_ID}:${method}`;
      if (attemptedFallbackRef.current.has(key)) return;
      attemptedFallbackRef.current.add(key);

      const run = transcodes.find((item) => item.id === effectivePackagingRunId);
      const other: StreamingMethod = method === "hls" ? "dash" : "hls";
      const available = other === "dash" ? run?.hasDash : run?.hasHls;
      if (!available) return;

      // Pin to manual so the Best-mode sync effect cannot immediately revert the fallback.
      setBestMode(false);
      setPackagingRunId(effectivePackagingRunId ?? SOURCE_RUN_ID);
      setStreamingMethod(other);
      setAbrAlgorithm(effectiveAbr);
      setRunNonce((nonce) => nonce + 1);
      setFallbackNotice(
        `${method.toUpperCase()} failed to play in this browser, so playback switched to ${other.toUpperCase()}.`,
      );
    },
    [benchmarkProgress.running, bestMode, effectivePackagingRunId, effectiveAbr, transcodes],
  );

  const playerTranscodeId =
    effectiveMethod === "source" || isSourceRun(effectivePackagingRunId)
      ? null
      : effectivePackagingRunId;

  const player = (
    <>
      {fallbackNotice && (
        <Alert>
          <AlertDescription>{fallbackNotice}</AlertDescription>
        </Alert>
      )}
      {playerReady ? (
        <VideoPlayer
          ref={playerRef}
          streamingMethod={effectiveMethod}
          abrAlgorithm={effectiveAbr}
          fastStart={bestMode && bestSettings !== null}
          benchmarkRun={benchmarkProgress.running}
          networkProfile={networkProfileNow}
          apiUrl={apiUrl}
          routeId={routeId}
          transcodeId={playerTranscodeId}
          subtitleTracks={subtitleTracks}
          onStatsUpdate={updateStats}
          onPlaybackEvent={onPlaybackEvent}
          runNonce={runNonce}
          onFatalError={handleFatalError}
        />
      ) : (
        <Skeleton className="aspect-video w-full" />
      )}
    </>
  );

  if (mode === "benchmark") {
    return (
      <div className="space-y-10">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-8">
            <div className="space-y-4">{player}</div>
            <PlaybackStats stats={stats} />
          </div>
          <aside className="xl:sticky xl:top-20 xl:self-start">
            <BenchmarkPanel
              progress={benchmarkProgress}
              results={benchmarkResults}
              ladders={benchmarkLadders}
              onStart={(profiles, selection) => {
                // A sweep sets configurations directly, so Best mode has to be off or its sync
                // effect would put its own choice back on the next render.
                setBestMode(false);
                void startBenchmark(selection, profiles);
              }}
              onCancel={cancelBenchmark}
              disabled={transcodesLoading}
            />
          </aside>
        </div>
        <BenchmarkSessionResults results={benchmarkResults} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-8">
        <div className="space-y-4">{player}</div>
        <PlaybackStats stats={stats} />
      </div>
      <aside className="xl:sticky xl:top-20 xl:self-start">
        <StreamingControls
          bestMode={bestMode}
          onBestModeChange={handleBestModeChange}
          streamingMethod={effectiveMethod}
          abrAlgorithm={effectiveAbr}
          packagingRunId={effectivePackagingRunId ?? SOURCE_RUN_ID}
          transcodes={transcodes}
          transcodesLoading={transcodesLoading}
          onStreamingMethodChange={setStreamingMethod}
          onAbrAlgorithmChange={setAbrAlgorithm}
          onPackagingRunChange={handlePackagingRunChange}
          bestReason={bestSettings?.reason}
        />
      </aside>
    </div>
  );
}
