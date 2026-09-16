import { useEffect, useRef } from "react";
import type Hls from "hls.js";
import type {
  StreamingMethod,
  CurrentStats,
  PlaybackEvent,
  VideoQuality,
} from "@/types/streaming";
import { formatQualityLabel } from "@/hooks/useVideoStats";
import { dashAudioBandwidth } from "@/lib/abr/driver";

interface UseVideoStatsTrackingProps {
  videoElement: HTMLVideoElement | null;
  streamingMethod: StreamingMethod;
  hlsInstance: Hls | null;
  dashInstance: any;
  onStatsUpdate?: (stats: Partial<CurrentStats>) => void;
  /** Stall and lifecycle edges the 1 Hz sampler cannot see. See {@link PlaybackEvent}. */
  onPlaybackEvent?: (event: PlaybackEvent) => void;
}

/** How close to the end of the media a "waiting" counts as the end of playback, seconds — six frames. */
const END_OF_MEDIA_TOLERANCE_SEC = 0.25;

interface HttpRangeThroughputState {
  /** Furthest buffered media time at the previous sample, seconds. */
  lastBufferedEnd: number;
  lastTimestampMs: number;
  lastBandwidthMbps: number;
}

interface HttpRangeBitrateState {
  url: string | null;
  contentLength: number | null;
  bitrateBps: number | null;
  /** The source's video codec as the server probed it (h264, hevc…); null until the HEAD answers. */
  codec: string | null;
  fetchStarted: boolean;
}

const EMPTY_BITRATE_STATE: HttpRangeBitrateState = {
  url: null,
  contentLength: null,
  bitrateBps: null,
  codec: null,
  fetchStarted: false,
};

export function useVideoStatsTracking({
  videoElement,
  streamingMethod,
  hlsInstance,
  dashInstance,
  onStatsUpdate,
  onPlaybackEvent,
}: UseVideoStatsTrackingProps) {
  const hasStartedPlayingRef = useRef(false);
  const stalledSinceRef = useRef<number | null>(null);

  // Held in refs so an inline callback from a parent does not tear down and rebuild the sampling
  // interval on every render, which would reset the cadence a measurement depends on.
  const statsCallbackRef = useRef(onStatsUpdate);
  const eventCallbackRef = useRef(onPlaybackEvent);
  statsCallbackRef.current = onStatsUpdate;
  eventCallbackRef.current = onPlaybackEvent;
  const throughputStateRef = useRef<HttpRangeThroughputState>({
    lastBufferedEnd: 0,
    lastTimestampMs: 0,
    lastBandwidthMbps: 0,
  });
  const bitrateStateRef = useRef<HttpRangeBitrateState>({ ...EMPTY_BITRATE_STATE });

  useEffect(() => {
    hasStartedPlayingRef.current = false;
    stalledSinceRef.current = null;
    throughputStateRef.current = {
      lastBufferedEnd: 0,
      lastTimestampMs: 0,
      lastBandwidthMbps: 0,
    };
    bitrateStateRef.current = { ...EMPTY_BITRATE_STATE };
  }, [streamingMethod, videoElement]);

  useEffect(() => {
    if (!videoElement) return;

    const emit = (kind: PlaybackEvent["kind"], message?: string) => {
      eventCallbackRef.current?.({ kind, atMs: performance.now(), message });
    };

    const handlePlaying = () => {
      if (!hasStartedPlayingRef.current) {
        hasStartedPlayingRef.current = true;
        emit("startup");
        return;
      }

      // Only a stall that began after the first frame is a rebuffer; the wait before it is the
      // startup delay, and charging that time twice would inflate the buffering ratio.
      if (stalledSinceRef.current !== null) {
        stalledSinceRef.current = null;
        emit("rebufferEnd");
      }
    };

    const handleStall = () => {
      if (!hasStartedPlayingRef.current || stalledSinceRef.current !== null) {
        return;
      }

      // Waiting on the last frames is the end of the clip, not a stall. In roughly one DASH run in
      // ten dash.js never signalled end of stream although the whole clip was buffered, so the
      // element fired "waiting" at the end instead of "ended" — and the run was recorded as a
      // minute-long stall until the runner's timeout. The cause inside dash.js was not found.
      if (
        Number.isFinite(videoElement.duration) &&
        videoElement.duration - videoElement.currentTime <= END_OF_MEDIA_TOLERANCE_SEC
      ) {
        emit("ended");
        return;
      }

      stalledSinceRef.current = performance.now();
      emit("rebufferStart");
    };

    const handleEnded = () => emit("ended");
    const handleError = () => emit("error", videoElement.error?.message ?? "playback error");

    const sample = () => {
      // Paused and stalled time is not playback. Sampling through it used to drag every average
      // toward whatever the player happened to be sitting at while nothing was being watched.
      if (!hasStartedPlayingRef.current || videoElement.paused) return;

      const stats = collectStats(
        videoElement,
        streamingMethod,
        hlsInstance,
        dashInstance,
        throughputStateRef.current,
        bitrateStateRef.current,
      );
      statsCallbackRef.current?.(stats);
    };

    // The source's size and codec are fetched once metadata is in, so they are known by the first
    // sample instead of being guessed from the resolution until the request came back.
    const handleMetadata = () => {
      if (streamingMethod === "source") {
        ensureSourceBitrate(videoElement, bitrateStateRef.current);
      }
    };

    // Sampled at once when playback starts and whenever the picture changes size — a rung switch —
    // so the displayed quality follows the picture instead of lagging up to a second behind it.
    // The metrics weight samples by the time between them, so the extra ones do not skew them.
    const sampleOnChange = () => queueMicrotask(sample);

    videoElement.addEventListener("playing", handlePlaying);
    videoElement.addEventListener("playing", sampleOnChange);
    videoElement.addEventListener("resize", sampleOnChange);
    videoElement.addEventListener("loadedmetadata", handleMetadata);
    videoElement.addEventListener("waiting", handleStall);
    videoElement.addEventListener("stalled", handleStall);
    videoElement.addEventListener("ended", handleEnded);
    videoElement.addEventListener("error", handleError);
    if (videoElement.readyState >= 1) {
      handleMetadata();
    }

    const interval = setInterval(sample, 1000);

    return () => {
      videoElement.removeEventListener("playing", handlePlaying);
      videoElement.removeEventListener("playing", sampleOnChange);
      videoElement.removeEventListener("resize", sampleOnChange);
      videoElement.removeEventListener("loadedmetadata", handleMetadata);
      videoElement.removeEventListener("waiting", handleStall);
      videoElement.removeEventListener("stalled", handleStall);
      videoElement.removeEventListener("ended", handleEnded);
      videoElement.removeEventListener("error", handleError);
      clearInterval(interval);
      hasStartedPlayingRef.current = false;
      stalledSinceRef.current = null;
    };
  }, [videoElement, streamingMethod, hlsInstance, dashInstance]);
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
    collectDashStats(dashInstance, video, stats);
  } else if (streamingMethod === "source") {
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

function collectDashStats(dash: any, video: HTMLVideoElement, stats: Partial<CurrentStats>) {
  const quality = getDashQuality(dash, video);
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

  const quality = getVideoElementQuality(video, bitrateState.bitrateBps, bitrateState.codec);
  stats.quality = quality;

  const measured = measureHttpRangeThroughput(video, throughputState, bitrateState.bitrateBps);
  if (measured > 0) {
    stats.bandwidth = measured;
  } else if (throughputState.lastBandwidthMbps > 0) {
    stats.bandwidth = throughputState.lastBandwidthMbps;
  } else {
    stats.bandwidth = 0;
  }
}

/**
 * Download rate of the progressive source, Mb/s: how far the buffered range grew since the previous
 * sample, at the source's average bitrate.
 *
 * Not Resource Timing, which this used to read: the browser records a request there only once it has
 * finished, and a progressive download of the whole source over a slow link does not finish within a
 * run, so on 3G no byte was ever counted and the throughput read empty. The buffered range grows as
 * the data arrives. Averaging a VBR file's bitrate makes a single sample approximate; the mean over a
 * run is not. A seek, which moves the range backwards, is ignored.
 *
 * On a link slower than the source's own bitrate — every shaped profile — the browser downloads
 * flat out and this is the link's capacity. On a faster one it downloads only as fast as it plays,
 * so an unshaped run reads roughly the source bitrate instead.
 */
function measureHttpRangeThroughput(
  video: HTMLVideoElement,
  state: HttpRangeThroughputState,
  sourceBitrateBps: number | null,
): number {
  const now = performance.now();
  const bufferedEnd = furthestBufferedEnd(video);

  if (state.lastTimestampMs <= 0 || !sourceBitrateBps || sourceBitrateBps <= 0) {
    state.lastBufferedEnd = bufferedEnd;
    state.lastTimestampMs = now;
    return state.lastBandwidthMbps;
  }

  const grownSec = bufferedEnd - state.lastBufferedEnd;
  const deltaSeconds = (now - state.lastTimestampMs) / 1000;

  state.lastBufferedEnd = bufferedEnd;
  state.lastTimestampMs = now;

  if (grownSec > 0 && deltaSeconds > 0) {
    const mbps = (grownSec * sourceBitrateBps) / deltaSeconds / 1_000_000;
    state.lastBandwidthMbps = mbps;
    return mbps;
  }

  return state.lastBandwidthMbps;
}

function furthestBufferedEnd(video: HTMLVideoElement): number {
  const { buffered } = video;
  return buffered.length > 0 ? buffered.end(buffered.length - 1) : 0;
}

function ensureSourceBitrate(
  video: HTMLVideoElement,
  state: HttpRangeBitrateState,
) {
  const mediaUrl = video.currentSrc || video.src;
  if (!mediaUrl) return;

  if (state.url !== mediaUrl) {
    Object.assign(state, EMPTY_BITRATE_STATE, { url: mediaUrl });
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

      state.codec = res.headers.get("x-video-codec");
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

/**
 * The DASH rung on screen.
 *
 * getCurrentRepresentationForType answers with the rung dash.js has scheduled for its next request,
 * where hls.js's currentLevel is the level of the fragment at the playhead. Read that way, DASH was
 * credited with a rung up to a whole buffer ahead of the picture: a run that played its first
 * segment at 480p was recorded as 1080p throughout. The frame on screen settles it, since every
 * ladder carries one rung per height. The bitrate includes the audio track, as an HLS BANDWIDTH does.
 */
function getDashQuality(dash: any, video: HTMLVideoElement): VideoQuality | null {
  try {
    if (dash.getCurrentRepresentationForType) {
      const representations: any[] = dash.getRepresentationsByType?.("video") ?? [];
      const onScreen =
        video.videoHeight > 0
          ? representations.find((representation) => representation.height === video.videoHeight)
          : undefined;
      const currentRep = onScreen ?? dash.getCurrentRepresentationForType("video");
      if (currentRep && currentRep.width && currentRep.height) {
        return {
          width: currentRep.width,
          height: currentRep.height,
          bitrate: (currentRep.bandwidth || currentRep.bitrate || 0) + dashAudioBandwidth(dash),
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

/**
 * The progressive source as played: its real dimensions, and the bitrate and codec the server
 * reports for the file. Both stay unknown (0 and undefined) until that answer arrives — they used to
 * be guessed from the resolution and printed as fact, so every 1080p source read "5 Mb/s, H.264".
 */
function getVideoElementQuality(
  video: HTMLVideoElement,
  sourceBitrateBps: number | null,
  sourceCodec: string | null,
): VideoQuality | null {
  if (video.readyState < 1 || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  return {
    width: video.videoWidth,
    height: video.videoHeight,
    bitrate: sourceBitrateBps ?? 0,
    label: formatQualityLabel(video.videoWidth, video.videoHeight),
    codec: sourceCodec ?? undefined,
  };
}
