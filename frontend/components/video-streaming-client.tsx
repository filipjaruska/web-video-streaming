"use client";

import { useEffect, useMemo, useState } from "react";
import type { StreamingMethod, AbrAlgorithm } from "@/types/streaming";
import { SOURCE_RUN_ID, isSourceRun } from "@/types/streaming";
import { StreamingControls } from "@/components/streaming-controls";
import { VideoPlayer } from "@/components/video-player";
import { VideoEncodingInfo } from "@/components/video-encoding-info";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useVideoStats } from "@/hooks/useVideoStats";
import { useVideoSubtitles } from "@/hooks/useVideoSubtitles";
import { useVideoTranscodes } from "@/hooks/useVideoTranscodes";
import { pickBestPlaybackSettings } from "@/lib/videoTranscodesApi";
import { getPublicApiUrl } from "@/lib/env";

interface VideoStreamingClientProps {
  routeId: string;
}

function StatTile({
  label,
  value,
  detail,
  emphasize,
  progress,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasize?: boolean;
  progress?: number;
}) {
  return (
    <div
      className={
        emphasize
          ? "rounded-md border border-primary/15 bg-secondary/50 p-3"
          : "rounded-md border bg-muted/60 p-3"
      }
    >
      <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="font-mono text-lg font-semibold tracking-tight">{value}</div>
      {detail && (
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      )}
      {typeof progress === "number" && (
        <Progress value={progress} className="mt-2 h-1.5" />
      )}
    </div>
  );
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

export function VideoStreamingClient({ routeId }: VideoStreamingClientProps) {
  const apiUrl = getPublicApiUrl();
  const { transcodes, activeTranscodeId, loading: transcodesLoading } =
    useVideoTranscodes(routeId);
  const { tracks: subtitleTracks } = useVideoSubtitles(routeId);

  const [bestMode, setBestMode] = useState(true);
  const [streamingMethod, setStreamingMethod] =
    useState<StreamingMethod>("source");
  const [abrAlgorithm, setAbrAlgorithm] = useState<AbrAlgorithm>("hybrid");
  const [packagingRunId, setPackagingRunId] = useState<string | null>(null);
  const { stats, updateStats, resetStats } = useVideoStats();

  const bestSettings = useMemo(() => {
    if (transcodesLoading) return null;
    return pickBestPlaybackSettings(transcodes, activeTranscodeId);
  }, [transcodes, activeTranscodeId, transcodesLoading]);

  // Keep manual state in sync with Best so unlocking starts from the auto pick.
  useEffect(() => {
    if (!bestMode || !bestSettings) return;
    setPackagingRunId((prev) =>
      prev === bestSettings.packagingRunId ? prev : bestSettings.packagingRunId,
    );
    setStreamingMethod((prev) =>
      prev === bestSettings.streamingMethod
        ? prev
        : bestSettings.streamingMethod,
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

  const effectiveMethod =
    bestMode && bestSettings ? bestSettings.streamingMethod : streamingMethod;
  const effectiveAbr =
    bestMode && bestSettings ? bestSettings.abrAlgorithm : abrAlgorithm;
  const effectivePackagingRunId =
    bestMode && bestSettings ? bestSettings.packagingRunId : packagingRunId;

  useEffect(() => {
    resetStats();
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

  const bufferProgress = Math.min(
    100,
    Math.max(0, (stats.current.bufferLevel / 30) * 100),
  );

  const playerTranscodeId =
    effectiveMethod === "source" || isSourceRun(effectivePackagingRunId)
      ? null
      : effectivePackagingRunId;

  return (
    <div className="space-y-4">
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
      />

      {playerReady ? (
        <VideoPlayer
          streamingMethod={effectiveMethod}
          abrAlgorithm={effectiveAbr}
          apiUrl={apiUrl}
          routeId={routeId}
          transcodeId={playerTranscodeId}
          subtitleTracks={subtitleTracks}
          onStatsUpdate={updateStats}
        />
      ) : (
        <div className="aspect-video w-full animate-pulse rounded-md bg-muted" />
      )}

      <VideoEncodingInfo
        quality={stats.current.quality}
        streamingMethod={effectiveMethod}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Playback statistics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Current
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile
                emphasize
                label="Quality"
                value={stats.current.quality?.label || "—"}
                detail={
                  stats.current.quality
                    ? `${stats.current.quality.width}×${stats.current.quality.height}`
                    : undefined
                }
              />
              <StatTile
                emphasize
                label="Buffer"
                value={`${stats.current.bufferLevel.toFixed(1)}s`}
                progress={bufferProgress}
              />
              <StatTile
                emphasize
                label="Bandwidth"
                value={`${stats.current.bandwidth.toFixed(2)}`}
                detail="Mbps"
              />
              <StatTile
                emphasize
                label="Dropped"
                value={String(stats.current.droppedFrames)}
                detail={`of ${stats.current.totalFrames}`}
              />
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Session averages
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile
                label="Quality"
                value={stats.average.avgQuality?.label || "—"}
                detail={
                  stats.average.avgQuality
                    ? `${stats.average.avgQuality.width}×${stats.average.avgQuality.height}`
                    : undefined
                }
              />
              <StatTile
                label="Buffer"
                value={`${stats.average.avgBufferLevel.toFixed(1)}s`}
              />
              <StatTile
                label="Bandwidth"
                value={`${stats.average.avgBandwidth.toFixed(2)}`}
                detail="Mbps"
              />
              <StatTile
                label="Dropped"
                value={`${stats.average.avgDroppedFramesRate.toFixed(2)}%`}
              />
              <StatTile
                label="Rebuffers"
                value={String(stats.average.totalRebufferingEvents)}
                detail={`${stats.average.totalRebufferingDuration.toFixed(1)}s`}
              />
              <StatTile
                label="Played"
                value={formatTime(stats.average.totalPlaybackTime)}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
