import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type {
  AbrAlgorithm,
  StreamingMethod,
  CurrentStats,
} from "@/types/streaming";
import { createHlsConfig, createDashSettings } from "@/lib/streamingConfig";
import { getVideoUrl } from "@/lib/streamingLabels";
import { useVideoStatsTracking } from "@/hooks/useVideoStatsTracking";

interface UseVideoPlayerProps {
  streamingMethod: StreamingMethod;
  abrAlgorithm: AbrAlgorithm;
  apiUrl: string;
  routeId: string;
  transcodeId?: string | null;
  onStatsUpdate?: (stats: Partial<CurrentStats>) => void;
}

/**
 * Custom hook for managing video player instances and streaming
 * Handles HLS, DASH, and HTTP Range streaming methods with ABR configuration
 */
export function useVideoPlayer({
  streamingMethod,
  abrAlgorithm,
  apiUrl,
  routeId,
  transcodeId = null,
  onStatsUpdate,
}: UseVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<any>(null);
  const playListenerRef = useRef<((e: Event) => void) | null>(null);
  const sessionRef = useRef(0);

  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
  const [dashInstance, setDashInstance] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useVideoStatsTracking({
    videoElement: videoRef.current,
    streamingMethod,
    hlsInstance,
    dashInstance,
    onStatsUpdate,
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const session = ++sessionRef.current;
    setError(null);
    teardownPlayers(video);

    if (streamingMethod === "hls") {
      setupHls(video, session);
    } else if (streamingMethod === "dash") {
      void setupDash(video, session);
    } else {
      setupHttpRange(video);
    }

    return () => {
      sessionRef.current += 1;
      teardownPlayers(video);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingMethod, abrAlgorithm, apiUrl, routeId, transcodeId]);

  function removePlayListener(video: HTMLVideoElement) {
    if (playListenerRef.current) {
      video.removeEventListener("play", playListenerRef.current);
      playListenerRef.current = null;
    }
  }

  function teardownPlayers(video: HTMLVideoElement) {
    removePlayListener(video);

    const hls = hlsRef.current;
    if (hls) {
      hlsRef.current = null;
      setHlsInstance(null);
      try {
        hls.destroy();
      } catch {
        // ignore
      }
    }

    const dash = dashRef.current;
    if (dash) {
      dashRef.current = null;
      setDashInstance(null);
      try {
        if (typeof dash.reset === "function") {
          dash.reset();
        }
        if (typeof dash.destroy === "function") {
          dash.destroy();
        }
      } catch {
        // dash.js may log SourceBuffer noise during teardown
      }
    }

    try {
      video.pause();
    } catch {
      // ignore
    }

    // Clear src without load() — load() races MSE teardown and causes
    // CHUNK_DEMUXER / SourceBuffer append failures on the next init.
    try {
      video.removeAttribute("src");
      video.srcObject = null;
    } catch {
      // ignore
    }
  }

  function setupHls(video: HTMLVideoElement, session: number) {
    if (Hls.isSupported()) {
      const hls = new Hls(createHlsConfig(abrAlgorithm));
      const hlsUrl = getVideoUrl("hls", apiUrl, routeId, transcodeId);

      hlsRef.current = hls;
      setHlsInstance(hls);

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      const startLoad = () => {
        if (sessionRef.current !== session) return;
        hls.startLoad();
        removePlayListener(video);
      };
      playListenerRef.current = startLoad;
      video.addEventListener("play", startLoad);

      if (abrAlgorithm === "baseline") {
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (sessionRef.current !== session) return;
          hls.currentLevel = hls.levels.length - 1;
        });
      }

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (sessionRef.current !== session) return;
        if (data.fatal) {
          console.error("HLS error:", data);
          setError(`HLS Error: ${data.type} - ${data.details}`);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = getVideoUrl("hls", apiUrl, routeId, transcodeId);
    } else {
      setError(
        "HLS is not supported in this browser. Please use a modern browser like Google Chrome or a Chromium-based alternative.",
      );
    }
  }

  async function setupDash(video: HTMLVideoElement, session: number) {
    const dashjs = await import("dashjs");
    if (sessionRef.current !== session || videoRef.current !== video) {
      return;
    }

    const dash = dashjs.MediaPlayer().create();
    const dashUrl = getVideoUrl("dash", apiUrl, routeId, transcodeId);

    dash.updateSettings(createDashSettings(abrAlgorithm));

    dashRef.current = dash;
    setDashInstance(dash);

    dash.on(dashjs.MediaPlayer.events.ERROR, (e: any) => {
      if (sessionRef.current !== session || dashRef.current !== dash) return;
      const message = formatDashError(e);
      console.error("DASH error:", message, e);
      setError(`DASH Error: ${message}`);
    });

    // Placeholder only so native controls show Play — do not fetch the MPD
    // or buffer segments until the user actually presses play (same intent as
    // HLS autoStartLoad: false). Cleared before MSE attach below.
    video.src = DASH_PLAY_PLACEHOLDER;

    const onPlay = (e: Event) => {
      e.preventDefault();
      if (sessionRef.current !== session || !videoRef.current) return;
      if (dashRef.current !== dash) return;

      removePlayListener(video);

      try {
        video.pause();
      } catch {
        // ignore
      }

      // Fully reset the progressive placeholder pipeline before MSE attach.
      try {
        video.removeAttribute("src");
        video.srcObject = null;
        video.load();
      } catch {
        // ignore
      }

      // Let the reset settle one frame, then start DASH (still only after Play).
      requestAnimationFrame(() => {
        if (sessionRef.current !== session || dashRef.current !== dash) return;
        if (!videoRef.current) return;
        dash.initialize(videoRef.current, dashUrl, true);
      });
    };

    playListenerRef.current = onPlay;
    video.addEventListener("play", onPlay);
  }

  function setupHttpRange(video: HTMLVideoElement) {
    video.src = getVideoUrl("http-range", apiUrl, routeId);
  }

  return {
    videoRef,
    error,
    hlsInstance,
    dashInstance,
  };
}

/** Minimal MP4 so <video controls> exposes Play without starting DASH fetch. */
const DASH_PLAY_PLACEHOLDER =
  "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVlAAAAG21kYXQAAAGzABAHAAABthADAowdbb9/AAAC6W1vb3YAAABsbXZoZAAAAAB8JbCAfCWwgAAAA+gAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAIVdHJhawAAAFx0a2hkAAAAD3wlsIB8JbCAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAIAAAACAAAAAABsW1kaWEAAAAgbWRoZAAAAAB8JbCAfCWwgAAAA+gAAAAAVcQAAAAAAC1oZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAAXxtaW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAE8c3RibAAAALhzdHNkAAAAAAAAAAEAAACobXA0dgAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAIAAgASAAAAEgAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABj//wAAAFJlc2RzAAAAAANEAAEABDwgEQAAAAADDUAAAAAABS0AAAGwAQAAAbWJEwAAAQAAAAEgAMSNiB9FAEQBFGMAAAGyTGF2YzUyLjg3LjQGAQIAAAAYc3R0cwAAAAAAAAABAAAAAQAAAAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAAAEwAAAAEAAAAUc3RjbwAAAAAAAAABAAAALAAAAGB1ZHRhAAAAWG1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAAK2lsc3QAAAAjqXRvbwAAABtkYXRhAAAAAQAAAABMYXZmNTIuNzguMw==";

function formatDashError(e: any): string {
  const err = e?.error ?? e;
  if (typeof err === "string") return err;
  if (err?.message) return String(err.message);
  if (err?.code != null) return String(err.code);
  if (e?.event?.error?.message) return String(e.event.error.message);
  try {
    return JSON.stringify(err) || "Unknown error";
  } catch {
    return "Unknown error";
  }
}
