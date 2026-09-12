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
  pickFastStartLevel,
  pickStartLevel,
  SEGMENT_SEC,
  TARGET_BUFFER_SEC,
  withCacheBust,
} from "@/lib/streamingConfig";
import {
  type AbrDriver,
  createRuleAbrController,
  dashAudioBandwidth,
  driveDash,
  pinHighestDash,
  pinHighestHls,
} from "@/lib/abr/driver";
import { getVideoUrl } from "@/lib/streamingLabels";
import { loadDashLibrary } from "@/lib/dashLibrary";
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
  /**
   * A fatal provider error. Reported rather than acted on: whether to retry over another protocol
   * is a policy question that depends on state this component does not own.
   */
  onFatalError?: (info: { method: StreamingMethod; message: string }) => void;
  /**
   * Best mode's fast start: open on the highest rung the connection allows and hold it until the
   * first segment is in. Presentation only — a benchmark sweep turns Best mode off, so no measured
   * run ever starts this way. See `pickFastStartLevel`.
   */
  fastStart?: boolean;
  /**
   * A benchmark run: every request this mount makes carries a per-run token, so none can be answered
   * from the browser's HTTP cache. Without it, repeated runs never touched the shaped network.
   */
  cacheBust?: boolean;
}

/**
 * Prefix of every benchmark token, fixed per page load. Combined with the per-run nonce it keeps
 * tokens unique across runs and across reloads, without calling anything impure during render.
 */
const PAGE_LOAD_TOKEN = Date.now().toString(36);

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
    onFatalError,
    fastStart = false,
    cacheBust = false,
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

  // One token per benchmark run: the player remounts on every runNonce, so no two runs share a URL.
  const cacheBustToken = cacheBust ? `${PAGE_LOAD_TOKEN}.${runNonce}` : null;

  const src = useMemo(
    () =>
      withCacheBust(
        getVideoUrl(
          streamingMethod,
          apiUrl,
          routeId,
          streamingMethod === "source" ? null : transcodeId,
        ),
        cacheBustToken,
      ),
    [streamingMethod, apiUrl, routeId, transcodeId, cacheBustToken],
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
  }, [src, abrAlgorithm, fastStart]);

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
          // The adaptive profiles answer hls.js's own per-fragment question with the shared rules,
          // opening rung included; the fixed-quality control keeps the stock controller and is
          // pinned once the manifest is in.
          ...(abrAlgorithm !== "baseline"
            ? {
                abrController: createRuleAbrController(
                  Hls.DefaultConfig.abrController,
                  abrAlgorithm,
                  TARGET_BUFFER_SEC,
                  { fastStart },
                ),
              }
            : {}),
          // Playlists and segments resolve relative to the manifest and lose its query string, so
          // the token has to be added to every request hls.js makes, not only the first.
          ...(cacheBustToken
            ? {
                xhrSetup: (xhr: XMLHttpRequest, url: string) =>
                  xhr.open("GET", withCacheBust(url, cacheBustToken), true),
              }
            : {}),
        };
        provider.library = () => import("hls.js");

        provider.onInstance((hls) => {
          setHlsInstance(hls);
          if (abrAlgorithm === "baseline") {
            hls.on(Hls.Events.MANIFEST_PARSED, () => pinHighestHls(hls));
          }
        });
      }

      if (isDASHProvider(provider)) {
        provider.config = createDashSettings(abrAlgorithm);
        // Not `() => import("dashjs")`: see `loadDashLibrary` — that left Vidstack without a dash.js
        // instance while dash.js's auto-create played the stream with its own ABR. Vidstack's type
        // wants the constructor itself under `default`; its loader also accepts the namespace.
        provider.library = loadDashLibrary as unknown as typeof provider.library;
        provider.onInstance((dash) => {
          setDashInstance(dash);

          // Vidstack's quality menu still calls dash.js 4's setQualityFor, which dash.js 5 removed;
          // without this, picking a quality from the player's own menu would throw.
          const legacy = dash as unknown as {
            setQualityFor?: unknown;
            setRepresentationForTypeByIndex?: (type: string, index: number, forceReplace?: boolean) => void;
          };
          if (typeof legacy.setQualityFor !== "function" && legacy.setRepresentationForTypeByIndex) {
            legacy.setQualityFor = (type: string, index: number, forceReplace?: boolean) =>
              legacy.setRepresentationForTypeByIndex?.(type, index, forceReplace);
          }

          if (cacheBustToken) {
            // Segment URLs come from the MPD's template and carry no query, so every request is
            // stamped on its way out. Registered before Vidstack attaches the source.
            const interceptable = dash as unknown as {
              addRequestInterceptor?: (
                interceptor: (request: { url: string }) => Promise<{ url: string }>,
              ) => void;
            };
            interceptable.addRequestInterceptor?.((request) => {
              request.url = withCacheBust(request.url, cacheBustToken);
              return Promise.resolve(request);
            });
          }

          const start = () => {
            if (abrAlgorithm === "baseline") {
              pinHighestDash(dash);
              return;
            }

            const levels = dash.getRepresentationsByType?.("video") ?? [];
            if (levels.length === 0) {
              return;
            }

            // Video plus audio — the figure an HLS BANDWIDTH declares — so both protocols open
            // on the same rung.
            const audio = dashAudioBandwidth(dash);
            const pick = fastStart ? pickFastStartLevel : pickStartLevel;
            const startAt = pick<{ index?: number; bandwidth?: number }>(
              levels,
              (level) => (level.bandwidth ?? 0) + audio,
            );
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
              { fastStart },
            );
          };

          dash.on?.("streamInitialized", start);
        });
      }
    },
    [abrAlgorithm, fastStart, cacheBustToken],
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
        key={`${streamingMethod}:${transcodeId ?? "source"}:${abrAlgorithm}:${fastStart ? "fast" : "fixed"}:${runNonce}`}
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
          // The player reports; the parent decides whether another protocol is worth trying. It
          // owns `streamingMethod` and knows whether a measurement is in flight.
          onFatalError?.({ method: streamingMethod, message: String(message) });
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
