"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  VideoStats,
  CurrentStats,
  AverageStats,
  VideoQuality,
  StatsSnapshot,
} from "@/types/streaming";

/**
 * Custom hook for tracking video streaming statistics
 * Tracks both current values and running averages throughout playback
 * Designed to be extensible for future metrics and persistence
 */
export function useVideoStats() {
  const [stats, setStats] = useState<VideoStats>({
    current: {
      quality: null,
      bufferLevel: 0,
      bandwidth: 0,
      droppedFrames: 0,
      totalFrames: 0,
      playbackTime: 0,
      rebufferingEvents: 0,
      rebufferingDuration: 0,
    },
    average: {
      avgQuality: null,
      avgBufferLevel: 0,
      avgBandwidth: 0,
      avgDroppedFramesRate: 0,
      totalRebufferingEvents: 0,
      totalRebufferingDuration: 0,
      totalPlaybackTime: 0,
    },
  });

  const snapshotsRef = useRef<StatsSnapshot[]>([]);
  const startTimeRef = useRef<number>(Date.now());
  const lastRebufferingRef = useRef<boolean>(false);

  /**
   * Update current statistics and recalculate averages
   * This method is called whenever new stats are available from the player
   */
  const updateStats = useCallback((newStats: Partial<CurrentStats>) => {
    setStats((prevStats) => {
      const updatedCurrent = { ...prevStats.current, ...newStats };

      const snapshot: StatsSnapshot = {
        timestamp: Date.now(),
        quality: updatedCurrent.quality,
        bufferLevel: updatedCurrent.bufferLevel,
        bandwidth: updatedCurrent.bandwidth,
        droppedFrames: updatedCurrent.droppedFrames,
        totalFrames: updatedCurrent.totalFrames,
      };

      snapshotsRef.current.push(snapshot);

      const averages = calculateAverages(snapshotsRef.current, updatedCurrent);

      return {
        current: updatedCurrent,
        average: averages,
      };
    });
  }, []);

  /**
   * Track rebuffering events (when video pauses to buffer)
   */
  const trackRebuffering = useCallback((isRebuffering: boolean) => {
    if (isRebuffering && !lastRebufferingRef.current) {
      setStats((prev) => ({
        ...prev,
        current: {
          ...prev.current,
          rebufferingEvents: prev.current.rebufferingEvents + 1,
        },
        average: {
          ...prev.average,
          totalRebufferingEvents: prev.average.totalRebufferingEvents + 1,
        },
      }));
    }
    lastRebufferingRef.current = isRebuffering;
  }, []);

  /**
   * Reset all statistics (useful when changing videos or streaming methods)
   */
  const resetStats = useCallback(() => {
    snapshotsRef.current = [];
    startTimeRef.current = Date.now();
    lastRebufferingRef.current = false;
    setStats({
      current: {
        quality: null,
        bufferLevel: 0,
        bandwidth: 0,
        droppedFrames: 0,
        totalFrames: 0,
        playbackTime: 0,
        rebufferingEvents: 0,
        rebufferingDuration: 0,
      },
      average: {
        avgQuality: null,
        avgBufferLevel: 0,
        avgBandwidth: 0,
        avgDroppedFramesRate: 0,
        totalRebufferingEvents: 0,
        totalRebufferingDuration: 0,
        totalPlaybackTime: 0,
      },
    });
  }, []);

  /**
   * Export statistics for persistence (future feature)
   * Returns a serializable object that can be saved to database/file
   */
  const exportStats = useCallback(() => {
    return {
      ...stats,
      sessionDuration: Date.now() - startTimeRef.current,
      snapshotCount: snapshotsRef.current.length,
      exportedAt: new Date().toISOString(),
    };
  }, [stats]);

  return {
    stats,
    updateStats,
    trackRebuffering,
    resetStats,
    exportStats,
  };
}

/**
 * Calculate running averages from all collected snapshots
 */
function calculateAverages(
  snapshots: StatsSnapshot[],
  currentStats: CurrentStats,
): AverageStats {
  if (snapshots.length === 0) {
    return {
      avgQuality: null,
      avgBufferLevel: 0,
      avgBandwidth: 0,
      avgDroppedFramesRate: 0,
      totalRebufferingEvents: currentStats.rebufferingEvents,
      totalRebufferingDuration: currentStats.rebufferingDuration,
      totalPlaybackTime: currentStats.playbackTime,
    };
  }

  const avgBufferLevel =
    snapshots.reduce((sum, s) => sum + s.bufferLevel, 0) / snapshots.length;

  const avgBandwidth =
    snapshots.reduce((sum, s) => sum + s.bandwidth, 0) / snapshots.length;

  const totalDropped = currentStats.droppedFrames;
  const totalFrames = currentStats.totalFrames;
  const avgDroppedFramesRate =
    totalFrames > 0 ? (totalDropped / totalFrames) * 100 : 0;

  const avgQuality = calculateAverageQuality(snapshots);

  return {
    avgQuality,
    avgBufferLevel,
    avgBandwidth,
    avgDroppedFramesRate,
    totalRebufferingEvents: currentStats.rebufferingEvents,
    totalRebufferingDuration: currentStats.rebufferingDuration,
    totalPlaybackTime: currentStats.playbackTime,
  };
}

/**
 * Calculate the average quality level weighted by time spent at each quality
 */
function calculateAverageQuality(
  snapshots: StatsSnapshot[],
): VideoQuality | null {
  const qualityMap = new Map<
    string,
    { quality: VideoQuality; count: number }
  >();

  for (const snapshot of snapshots) {
    if (snapshot.quality) {
      const key = `${snapshot.quality.width}x${snapshot.quality.height}`;
      const existing = qualityMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        qualityMap.set(key, { quality: snapshot.quality, count: 1 });
      }
    }
  }

  if (qualityMap.size === 0) {
    return null;
  }

  let maxCount = 0;
  let dominantQuality: VideoQuality | null = null;

  for (const { quality, count } of qualityMap.values()) {
    if (count > maxCount) {
      maxCount = count;
      dominantQuality = quality;
    }
  }

  return dominantQuality;
}

/**
 * Helper to format quality label from dimensions
 */
export function formatQualityLabel(width: number, height: number): string {
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height >= 480) return "480p";
  if (height >= 360) return "360p";
  return `${height}p`;
}
