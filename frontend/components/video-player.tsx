"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Hls from "hls.js";
import {
  MediaPlayer,
  MediaProvider,
  Track,
  isDASHProvider,
  isHLSProvider,
  isVideoProvider,
  type MediaPlayerInstance,
  type MediaProviderAdapter,
  type MediaProviderChangeEvent,
  type MediaProviderSetupEvent,
} from "@vidstack/react";
import {
  DefaultVideoLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default";
import type {
  AbrAlgorithm,
  StreamingMethod,
  CurrentStats,
  PlaybackEvent,
} from "@/types/streaming";
import {
  createHlsConfig,
  createDashSettings,
  SEGMENT_SEC,
  START_LEVEL_FROM_BOTTOM,
  TARGET_BUFFER_SEC,
} from "@/lib/streamingConfig";
import {
  type AbrDriver,
  driveDash,
  driveHls,
  pinHighestDash,
  pinHighestHls,
} from "@/lib/abr/driver";
import { getVideoUrl } from "@/lib/streamingLabels";
import { useVideoStatsTracking } from "@/hooks/useVideoStatsTracking";
import { ErrorBanner } from "@/components/error-banner";
import type { SubtitleTrack } from "@/lib/videoSubtitlesApi";

import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";

interface VideoPlayerProps {
  streamingMethod: StreamingMethod;
  abrAlgorithm: AbrAlgorithm;
  apiUrl: string;
  routeId: string;
  transcodeId?: string | null;
  subtitleTracks?: SubtitleTrack[];
  onStatsUpdate?: (stats: Partial<CurrentStats>) => void;
  /** Stall and lifecycle edges, forwarded from the tracking hook. */
  onPlaybackEvent?: (event: PlaybackEvent) => void;
  /**
   * Bumping this remounts the player even when nothing else changed.
   *
   * The remount key is otherwise built from protocol, ladder and algorithm alone, so repeating an
   * identical configuration — which is exactly what a repetition is — would reuse the existing
   * player and its warm buffer, and the second run would not be measuring the same thing.
   */
  runNonce?: number;
}

/** What a benchmark needs in order to drive playback rather than wait for a viewer. */
export interface VideoPlayerHandle {
  play: () => Promise<void>;
  pause: () => void;
  seekToStart: () => void;
  /** Media duration in seconds, or null before metadata has loaded. */
  getDuration: () => number | null;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  {
    streamingMethod,
    abrAlgorithm,
    apiUrl,
    routeId,
    transcodeId = null,
    subtitleTracks = [],
    onStatsUpdate,
    onPlaybackEvent,
    runNonce = 0,
  }: VideoPlayerProps,
  ref,
) {
  const playerRef = useRef<MediaPlayerInstance>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(
    null,
  );
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
  const [dashInstance, setDashInstance] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const src = useMemo(
    () =>
      getVideoUrl(
        streamingMethod,
        apiUrl,
        routeId,
        streamingMethod === "source" ? null : transcodeId,
      ),
    [streamingMethod, apiUrl, routeId, transcodeId],
  );

  // Deferred load for adaptive streams; progressive can idle-load when visible.
  const loadStrategy =
    streamingMethod === "source" ? ("visible" as const) : ("play" as const);

  useVideoStatsTracking({
    videoElement,
    streamingMethod,
    hlsInstance,
    dashInstance,
    onStatsUpdate,
    onPlaybackEvent,
  });

  useImperativeHandle(
    ref,
    () => ({
      play: async () => {
        // Adaptive sources use load="play", so nothing is fetched until playback is asked for —
        // an automated run has to ask, since no viewer will.
        await playerRef.current?.play();
      },
      pause: () => playerRef.current?.pause(),
      seekToStart: () => {
        if (playerRef.current) {
          playerRef.current.currentTime = 0;
        }
      },
      getDuration: () => {
        const duration = playerRef.current?.state.duration;
        return duration && Number.isFinite(duration) ? duration : null;
      },
    }),
    [],
  );

  // The decision loop outlives neither the source nor the profile: switching either tears down the
  // player, so a driver left running would keep ticking against a detached instance.
  const driverRef = useRef<AbrDriver | null>(null);

  useEffect(() => {
    setError(null);
    setHlsInstance(null);
    setDashInstance(null);

    return () => {
      driverRef.current?.stop();
      driverRef.current = null;
    };
  }, [src, abrAlgorithm]);

  const onProviderChange = useCallback(
    (
      provider: MediaProviderAdapter | null,
      _nativeEvent: MediaProviderChangeEvent,
    ) => {
      if (!provider) {
        setVideoElement(null);
        setHlsInstance(null);
        setDashInstance(null);
        return;
      }

      if (isHLSProvider(provider)) {
        // Vidstack `load="play"` already defers network; allow hls.js to fetch on attach.
        provider.config = {
          ...createHlsConfig(),
          autoStartLoad: true,
        };
        provider.library = () => import("hls.js");

        provider.onInstance((hls) => {
          setHlsInstance(hls);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (hls.levels.length === 0) {
              return;
            }

            if (abrAlgorithm === "baseline") {
              pinHighestHls(hls);
              return;
            }

            hls.nextLevel = Math.min(
              START_LEVEL_FROM_BOTTOM,
              hls.levels.length - 1,
            );
            driverRef.current?.stop();
            driverRef.current = driveHls(hls, abrAlgorithm, TARGET_BUFFER_SEC);
          });
        });
      }

      if (isDASHProvider(provider)) {
        provider.config = createDashSettings(abrAlgorithm);
        provider.library = () => import("dashjs");
        provider.onInstance((dash) => {
          setDashInstance(dash);

          const start = () => {
            if (abrAlgorithm === "baseline") {
              pinHighestDash(dash);
              return;
            }

            const levels = dash.getRepresentationsByType?.("video") ?? [];
            if (levels.length === 0) {
              return;
            }

            const ascending = [...levels].sort(
              (a, b) => (a.bandwidth ?? 0) - (b.bandwidth ?? 0),
            );
            const startAt =
              ascending[Math.min(START_LEVEL_FROM_BOTTOM, ascending.length - 1)];
            dash.setRepresentationForTypeByIndex?.(
              "video",
              startAt?.index ?? 0,
              true,
            );

            driverRef.current?.stop();
            driverRef.current = driveDash(
              dash,
              abrAlgorithm,
              TARGET_BUFFER_SEC,
              SEGMENT_SEC,
            );
          };

          dash.on?.("streamInitialized", start);
        });
      }
    },
    [abrAlgorithm],
  );

  const onProviderSetup = useCallback(
    (
      provider: MediaProviderAdapter,
      _nativeEvent: MediaProviderSetupEvent,
    ) => {
      if (isVideoProvider(provider) || isHLSProvider(provider) || isDASHProvider(provider)) {
        setVideoElement(provider.video);
      }
    },
    [],
  );

  return (
    <div className="relative space-y-3">
      {error && <ErrorBanner title="Playback Error" message={error} />}
      <MediaPlayer
        key={`${streamingMethod}:${transcodeId ?? "source"}:${abrAlgorithm}:${runNonce}`}
        className="aspect-video w-full overflow-hidden rounded-md bg-black shadow-sm media-player"
        title="Video"
        src={src}
        viewType="video"
        streamType="on-demand"
        logLevel="warn"
        crossOrigin
        playsInline
        load={loadStrategy}
        preload="none"
        ref={playerRef}
        onProviderChange={onProviderChange}
        onProviderSetup={onProviderSetup}
        onError={(detail) => {
          const message =
            (detail as { message?: string })?.message ||
            (typeof detail === "string" ? detail : "Playback failed");
          setError(String(message));
        }}
      >
        <MediaProvider>
          {subtitleTracks.map((track) => (
            <Track
              key={track.id}
              id={track.id}
              src={track.url}
              kind="subtitles"
              label={track.label}
              language={track.language || "und"}
              type="vtt"
            />
          ))}
        </MediaProvider>
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>
    </div>
  );
});
