import { useEffect, useRef } from "react";
import type Hls from "hls.js";
import type {
  StreamingMethod,
  CurrentStats,
  VideoQuality,
} from "@/types/streaming";
import { formatQualityLabel } from "@/hooks/useVideoStats";

interface UseVideoStatsTrackingProps {
  videoElement: HTMLVideoElement | null;
  streamingMethod: StreamingMethod;
  hlsInstance: Hls | null;
  dashInstance: any;
  onStatsUpdate?: (stats: Partial<CurrentStats>) => void;
}

interface HttpRangeThroughputState {
  lastBytes: number;
  lastTimestampMs: number;
  lastBandwidthMbps: number;
}

interface HttpRangeBitrateState {
  url: string | null;
  contentLength: number | null;
  bitrateBps: number | null;
  fetchStarted: boolean;
}

export function useVideoStatsTracking({
  videoElement,
  streamingMethod,
  hlsInstance,
  dashInstance,
  onStatsUpdate,
}: UseVideoStatsTrackingProps) {
  const hasStartedPlayingRef = useRef(false);
  const throughputStateRef = useRef<HttpRangeThroughputState>({
    lastBytes: 0,
    lastTimestampMs: 0,
    lastBandwidthMbps: 0,
  });
  const bitrateStateRef = useRef<HttpRangeBitrateState>({
    url: null,
    contentLength: null,
    bitrateBps: null,
    fetchStarted: false,
  });

  useEffect(() => {
    hasStartedPlayingRef.current = false;
    throughputStateRef.current = {
      lastBytes: 0,
      lastTimestampMs: 0,
      lastBandwidthMbps: 0,
    };
    bitrateStateRef.current = {
      url: null,
      contentLength: null,
      bitrateBps: null,
      fetchStarted: false,
    };
  }, [streamingMethod, videoElement]);

  useEffect(() => {
    if (!videoElement || !onStatsUpdate) return;

    const handlePlaying = () => {
      hasStartedPlayingRef.current = true;
    };
    videoElement.addEventListener("playing", handlePlaying);

    const interval = setInterval(() => {
      if (!hasStartedPlayingRef.current) return;

      const stats = collectStats(
        videoElement,
        streamingMethod,
        hlsInstance,
        dashInstance,
        throughputStateRef.current,
        bitrateStateRef.current,
      );
      onStatsUpdate(stats);
    }, 1000);

    return () => {
      videoElement.removeEventListener("playing", handlePlaying);
      clearInterval(interval);
      hasStartedPlayingRef.current = false;
    };
  }, [videoElement, streamingMethod, hlsInstance, dashInstance, onStatsUpdate]);
}

function collectStats(
  video: HTMLVideoElement,
  streamingMethod: StreamingMethod,
  hlsInstance: Hls | null,
  dashInstance: any,
  throughputState: HttpRangeThroughputState,
  bitrateState: HttpRangeBitrateState,
): Partial<CurrentStats> {
  const stats: Partial<CurrentStats> = {
    bufferLevel: getBufferLevel(video),
    playbackTime: video.currentTime,
  };

  if (streamingMethod === "hls" && hlsInstance) {
    collectHlsStats(hlsInstance, stats);
  } else if (streamingMethod === "dash" && dashInstance) {
    collectDashStats(dashInstance, stats);
  } else if (streamingMethod === "http-range") {
    collectHttpRangeStats(video, stats, throughputState, bitrateState);
  }

  collectDroppedFramesStats(video, stats);

  return stats;
}

function collectHlsStats(hls: Hls, stats: Partial<CurrentStats>) {
  const quality = getHlsQuality(hls);
  if (quality) stats.quality = quality;

  const bandwidth = hls.bandwidthEstimate;
  if (bandwidth && bandwidth > 0) {
    stats.bandwidth = bandwidth / 1000000;
  }
}

function collectDashStats(dash: any, stats: Partial<CurrentStats>) {
  const quality = getDashQuality(dash);
  if (quality) stats.quality = quality;

  try {
    let foundBandwidth = false;

    if (dash.getAverageThroughput) {
      const throughput = dash.getAverageThroughput("video");
      if (throughput && throughput > 0) {
        stats.bandwidth =
          throughput > 100000 ? throughput / 1000000 : throughput / 1000;
        foundBandwidth = true;
      }
    }

    if (!foundBandwidth) {
      const dashMetrics = dash.getDashMetrics();
      if (dashMetrics) {
        const httpList = dashMetrics.getHttpRequests?.("video");
        if (httpList && httpList.length > 0) {
          const recentRequests = httpList
            .filter((req: any) => req._tfinish > 0 && req.bytesLoaded > 0)
            .slice(-3);

          if (recentRequests.length > 0) {
            let totalBandwidth = 0;
            recentRequests.forEach((req: any) => {
              const duration = (req._tfinish - req._trequest) / 1000;
              if (duration > 0) {
                totalBandwidth += (req.bytesLoaded * 8) / duration / 1000000;
              }
            });
            if (totalBandwidth > 0) {
              stats.bandwidth = totalBandwidth / recentRequests.length;
              foundBandwidth = true;
            }
          }
        }
      }
    }

    if (!foundBandwidth) {
      const currentRep = dash.getCurrentRepresentationForType?.("video");
      if (currentRep && currentRep.bandwidth) {
        stats.bandwidth = currentRep.bandwidth / 1000000;
      }
    }
  } catch (e) {
    console.error("Error getting DASH bandwidth:", e);
  }
}

function collectHttpRangeStats(
  video: HTMLVideoElement,
  stats: Partial<CurrentStats>,
  throughputState: HttpRangeThroughputState,
  bitrateState: HttpRangeBitrateState,
) {
  ensureSourceBitrate(video, bitrateState);

  const quality = getVideoElementQuality(video, bitrateState.bitrateBps);
  stats.quality = quality;

  const measured = measureHttpRangeThroughput(video, throughputState);
  if (measured > 0) {
    stats.bandwidth = measured;
  } else if (throughputState.lastBandwidthMbps > 0) {
    stats.bandwidth = throughputState.lastBandwidthMbps;
  } else {
    stats.bandwidth = 0;
  }
}

function measureHttpRangeThroughput(
  video: HTMLVideoElement,
  state: HttpRangeThroughputState,
): number {
  const mediaUrl = video.currentSrc || video.src;
  if (!mediaUrl || typeof performance === "undefined") {
    return state.lastBandwidthMbps;
  }

  const totalBytes = sumResourceTransferBytes(mediaUrl);
  const now = performance.now();

  if (state.lastTimestampMs <= 0) {
    state.lastBytes = totalBytes;
    state.lastTimestampMs = now;
    return state.lastBandwidthMbps;
  }

  const deltaBytes = totalBytes - state.lastBytes;
  const deltaSeconds = (now - state.lastTimestampMs) / 1000;

  state.lastBytes = totalBytes;
  state.lastTimestampMs = now;

  if (deltaBytes > 0 && deltaSeconds > 0) {
    const mbps = (deltaBytes * 8) / deltaSeconds / 1_000_000;
    state.lastBandwidthMbps = mbps;
    return mbps;
  }

  return state.lastBandwidthMbps;
}

function sumResourceTransferBytes(mediaUrl: string): number {
  try {
    const entries = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];

    let total = 0;
    for (const entry of entries) {
      if (!resourceMatchesMediaUrl(entry.name, mediaUrl)) continue;
      const bytes =
        entry.transferSize > 0
          ? entry.transferSize
          : entry.encodedBodySize > 0
            ? entry.encodedBodySize
            : 0;
      total += bytes;
    }
    return total;
  } catch {
    return 0;
  }
}

function resourceMatchesMediaUrl(entryName: string, mediaUrl: string): boolean {
  if (entryName === mediaUrl) return true;

  try {
    const entry = new URL(entryName);
    const media = new URL(mediaUrl, window.location.href);
    return (
      entry.origin === media.origin &&
      entry.pathname === media.pathname &&
      entry.pathname.includes("/api/httprange/")
    );
  } catch {
    return (
      entryName.includes("/api/httprange/") &&
      mediaUrl.includes("/api/httprange/")
    );
  }
}

function ensureSourceBitrate(
  video: HTMLVideoElement,
  state: HttpRangeBitrateState,
) {
  const mediaUrl = video.currentSrc || video.src;
  if (!mediaUrl) return;

  if (state.url !== mediaUrl) {
    state.url = mediaUrl;
    state.contentLength = null;
    state.bitrateBps = null;
    state.fetchStarted = false;
  }

  if (
    state.contentLength != null &&
    state.bitrateBps == null &&
    Number.isFinite(video.duration) &&
    video.duration > 0
  ) {
    state.bitrateBps = Math.round((state.contentLength * 8) / video.duration);
    return;
  }

  if (state.bitrateBps != null || state.fetchStarted) return;
  state.fetchStarted = true;

  void fetch(mediaUrl, { method: "HEAD" })
    .then((res) => {
      const lengthHeader = res.headers.get("content-length");
      const length = lengthHeader ? Number(lengthHeader) : NaN;
      if (!Number.isFinite(length) || length <= 0) {
        if (state.url === mediaUrl) state.fetchStarted = false;
        return;
      }

      // Ignore stale responses after the media URL changed.
      if (state.url !== mediaUrl) return;

      state.contentLength = length;
      if (Number.isFinite(video.duration) && video.duration > 0) {
        state.bitrateBps = Math.round((length * 8) / video.duration);
      }
    })
    .catch(() => {
      // Allow a later poll to retry if HEAD fails.
      if (state.url === mediaUrl) {
        state.fetchStarted = false;
      }
    });
}

function collectDroppedFramesStats(
  video: HTMLVideoElement,
  stats: Partial<CurrentStats>,
) {
  if ((video as any).getVideoPlaybackQuality) {
    const playbackQuality = (video as any).getVideoPlaybackQuality();
    stats.droppedFrames = playbackQuality.droppedVideoFrames || 0;
    stats.totalFrames = playbackQuality.totalVideoFrames || 0;
  }
}

function getBufferLevel(video: HTMLVideoElement): number {
  try {
    if (video.buffered.length > 0) {
      const currentTime = video.currentTime;
      for (let i = 0; i < video.buffered.length; i++) {
        if (
          video.buffered.start(i) <= currentTime &&
          currentTime <= video.buffered.end(i)
        ) {
          return video.buffered.end(i) - currentTime;
        }
      }
    }
  } catch (e) {
    // Ignore
  }
  return 0;
}

function getHlsQuality(hls: Hls): VideoQuality | null {
  try {
    const currentLevel = hls.currentLevel;
    if (currentLevel >= 0 && hls.levels && hls.levels[currentLevel]) {
      const level = hls.levels[currentLevel];
      return {
        width: level.width,
        height: level.height,
        bitrate: level.bitrate,
        label: formatQualityLabel(level.width, level.height),
        codec: level.videoCodec || level.attrs?.CODECS,
      };
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

function getDashQuality(dash: any): VideoQuality | null {
  try {
    if (dash.getCurrentRepresentationForType) {
      const currentRep = dash.getCurrentRepresentationForType("video");
      if (currentRep && currentRep.width && currentRep.height) {
        return {
          width: currentRep.width,
          height: currentRep.height,
          bitrate: currentRep.bandwidth || currentRep.bitrate || 0,
          label: formatQualityLabel(currentRep.width, currentRep.height),
          codec:
            currentRep.codecs ||
            currentRep.mimeType?.split('codecs="')[1]?.split('"')[0],
        };
      }
    }

    if (dash.getBitrateInfoListFor && dash.getQualityFor) {
      const bitrateList = dash.getBitrateInfoListFor("video");
      const currentQuality = dash.getQualityFor("video");
      if (
        bitrateList &&
        currentQuality !== undefined &&
        bitrateList[currentQuality]
      ) {
        const quality = bitrateList[currentQuality];
        return {
          width: quality.width,
          height: quality.height,
          bitrate: quality.bitrate || quality.bandwidth || 0,
          label: formatQualityLabel(quality.width, quality.height),
          codec: quality.codecs,
        };
      }
    }
  } catch (e) {
    console.error("Error getting DASH quality:", e);
  }
  return null;
}

function getVideoElementQuality(
  video: HTMLVideoElement,
  sourceBitrateBps: number | null,
): VideoQuality | null {
  try {
    if (video.readyState < 1) {
      return null;
    }

    if (video.videoWidth && video.videoHeight) {
      const bitrate =
        sourceBitrateBps != null && sourceBitrateBps > 0
          ? sourceBitrateBps
          : estimateBitrateFromResolution(video.videoWidth, video.videoHeight);

      let codec: string | undefined;

      const videoTracks = (video as any).videoTracks;
      if (videoTracks && videoTracks.length > 0) {
        codec = videoTracks[0].configuration?.codec;
      }

      if (!codec && video.currentSrc) {
        if (video.currentSrc.includes(".mp4") || video.currentSrc.includes("/api/httprange/")) {
          codec = "avc1.64001f";
        }
      }

      return {
        width: video.videoWidth,
        height: video.videoHeight,
        bitrate,
        label: formatQualityLabel(video.videoWidth, video.videoHeight),
        codec: codec || "H.264",
      };
    }
  } catch (e) {
    console.error("Error getting video element quality:", e);
  }
  return null;
}

function estimateBitrateFromResolution(width: number, height: number): number {
  const pixels = width * height;
  if (pixels >= 3840 * 2160) return 20_000_000;
  if (pixels >= 1920 * 1080) return 5_000_000;
  if (pixels >= 1280 * 720) return 2_500_000;
  if (pixels >= 854 * 480) return 1_000_000;
  if (pixels >= 640 * 360) return 800_000;
  return 500_000;
}
