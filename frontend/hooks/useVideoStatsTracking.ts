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

export function useVideoStatsTracking({
  videoElement,
  streamingMethod,
  hlsInstance,
  dashInstance,
  onStatsUpdate,
}: UseVideoStatsTrackingProps) {
  const hasStartedPlayingRef = useRef<boolean>(false);

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
    collectHttpRangeStats(video, stats);
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
) {
  const quality = getVideoElementQuality(video);
  if (quality) {
    stats.quality = quality;
    // Convert bitrate from bps to Mbps
    stats.bandwidth = quality.bitrate / 1000000;
  } else {
    stats.quality = null;
    stats.bandwidth = 0;
  }
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

function getVideoElementQuality(video: HTMLVideoElement): VideoQuality | null {
  try {
    // Check if video metadata is loaded
    if (video.readyState < 1) {
      return null; // Metadata not loaded yet
    }

    if (video.videoWidth && video.videoHeight) {
      // Better bitrate estimation based on resolution
      const pixels = video.videoWidth * video.videoHeight;
      let estimatedBitrate: number;

      // More realistic bitrate estimates for common resolutions
      if (pixels >= 3840 * 2160) {
        estimatedBitrate = 20000000; // 4K ~20 Mbps
      } else if (pixels >= 1920 * 1080) {
        estimatedBitrate = 5000000; // 1080p ~5 Mbps
      } else if (pixels >= 1280 * 720) {
        estimatedBitrate = 2500000; // 720p ~2.5 Mbps
      } else if (pixels >= 854 * 480) {
        estimatedBitrate = 1000000; // 480p ~1 Mbps
      } else if (pixels >= 640 * 360) {
        estimatedBitrate = 800000; // 360p ~800 Kbps
      } else {
        estimatedBitrate = 500000; // Lower ~500 Kbps
      }

      let codec: string | undefined;

      // Try multiple methods to get codec info
      const videoTracks = (video as any).videoTracks;
      if (videoTracks && videoTracks.length > 0) {
        codec = videoTracks[0].configuration?.codec;
      }

      // Fallback: try to get from source type
      if (!codec && video.currentSrc) {
        // Most likely H.264 for MP4 files
        if (video.currentSrc.includes(".mp4")) {
          codec = "avc1.64001f"; // H.264 High Profile
        }
      }

      return {
        width: video.videoWidth,
        height: video.videoHeight,
        bitrate: estimatedBitrate,
        label: formatQualityLabel(video.videoWidth, video.videoHeight),
        codec: codec || "H.264",
      };
    }
  } catch (e) {
    console.error("Error getting video element quality:", e);
  }
  return null;
}
