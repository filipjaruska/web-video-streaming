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
  onStatsUpdate,
}: UseVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
  const [dashInstance, setDashInstance] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const playListenerRef = useRef<(() => void) | null>(null);

  useVideoStatsTracking({
    videoElement: videoRef.current,
    streamingMethod,
    hlsInstance,
    dashInstance,
    onStatsUpdate,
  });

  useEffect(() => {
    if (!videoRef.current) return;

    setError(null);

    cleanupInstances();

    if (streamingMethod === "hls") {
      initializeHls();
    } else if (streamingMethod === "dash") {
      initializeDash();
    } else {
      initializeHttpRange();
    }

    // Cleanup on unmount or when dependencies change
    return cleanupInstances;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingMethod, abrAlgorithm, apiUrl, routeId]);

  function cleanupInstances() {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }

    if (playListenerRef.current && videoRef.current) {
      videoRef.current.removeEventListener("play", playListenerRef.current);
      playListenerRef.current = null;
    }

    if (hlsInstance) {
      try {
        hlsInstance.destroy();
      } catch (e) {
        console.error("Error destroying HLS instance:", e);
      }
      setHlsInstance(null);
    }

    if (dashInstance) {
      try {
        // Only reset if the player is actually initialized
        if (dashInstance.isReady && dashInstance.isReady()) {
          dashInstance.reset();
        }
      } catch (e) {
        // Silently ignore reset errors - player may not be fully initialized
      }
      setDashInstance(null);
    }

    // Clear video src for clean state
    if (videoRef.current) {
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
  }

  /**
   * Initialize HLS streaming
   */
  function initializeHls() {
    if (!videoRef.current) return;

    if (Hls.isSupported()) {
      const hlsConfig = createHlsConfig(abrAlgorithm);
      const hls = new Hls(hlsConfig);
      const hlsUrl = getVideoUrl("hls", apiUrl, routeId);

      hls.loadSource(hlsUrl);
      hls.attachMedia(videoRef.current);

      // Start loading only when user interacts (play button)
      const startLoad = () => {
        hls.startLoad();
        if (playListenerRef.current && videoRef.current) {
          videoRef.current.removeEventListener("play", playListenerRef.current);
          playListenerRef.current = null;
        }
      };
      playListenerRef.current = startLoad;
      videoRef.current.addEventListener("play", startLoad);

      // Lock to highest quality for baseline mode
      if (abrAlgorithm === "baseline") {
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          hls.currentLevel = hls.levels.length - 1;
        });
      }

      // Handle errors
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.error("HLS error:", data);
          setError(`HLS Error: ${data.type} - ${data.details}`);
        }
      });

      setHlsInstance(hls);
    } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS support (Safari)
      videoRef.current.src = getVideoUrl("hls", apiUrl, routeId);
    } else {
      setError(
        "HLS is not supported in this browser. Please use a modern browser like Google Chrome or a Chromium-based alternative.",
      );
    }
  }

  /**
   * Initialize DASH streaming
   */
  async function initializeDash() {
    if (!videoRef.current) return;

    // Dynamically import dashjs only on client side
    const dashjs = await import("dashjs");
    const dash = dashjs.MediaPlayer().create();
    const dashSettings = createDashSettings(abrAlgorithm);
    const dashUrl = getVideoUrl("dash", apiUrl, routeId);

    dash.updateSettings(dashSettings);

    // Set up video element first - use a data URL to make play button work
    const dataUrl =
      "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVlAAAAG21kYXQAAAGzABAHAAABthADAowdbb9/AAAC6W1vb3YAAABsbXZoZAAAAAB8JbCAfCWwgAAAA+gAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAIVdHJhawAAAFx0a2hkAAAAD3wlsIB8JbCAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAIAAAACAAAAAABsW1kaWEAAAAgbWRoZAAAAAB8JbCAfCWwgAAAA+gAAAAAVcQAAAAAAC1oZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAAXxtaW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAE8c3RibAAAALhzdHNkAAAAAAAAAAEAAACobXA0dgAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAIAAgASAAAAEgAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABj//wAAAFJlc2RzAAAAAANEAAEABDwgEQAAAAADDUAAAAAABS0AAAGwAQAAAbWJEwAAAQAAAAEgAMSNiB9FAEQBFGMAAAGyTGF2YzUyLjg3LjQGAQIAAAAYc3R0cwAAAAAAAAABAAAAAQAAAAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAAAEwAAAAEAAAAUc3RjbwAAAAAAAAABAAAALAAAAGB1ZHRhAAAAWG1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAAK2lsc3QAAAAjqXRvbwAAABtkYXRhAAAAAQAAAABMYXZmNTIuNzguMw==";

    videoRef.current.src = dataUrl;

    // When play is clicked, prevent default and initialize DASH instead
    const onPlay = (e: Event) => {
      e.preventDefault();
      if (!videoRef.current) return;
      videoRef.current.pause();
      // DASH will take over the video element
      dash.initialize(videoRef.current, dashUrl, true);
      if (playListenerRef.current && videoRef.current) {
        videoRef.current.removeEventListener("play", playListenerRef.current);
        playListenerRef.current = null;
      }
    };
    playListenerRef.current = onPlay as () => void;
    videoRef.current.addEventListener("play", onPlay);

    // Handle errors
    dash.on(dashjs.MediaPlayer.events.ERROR, (e: any) => {
      console.error("DASH error:", e);
      setError(`DASH Error: ${e.error?.code || "Unknown error"}`);
    });

    setDashInstance(dash);
  }

  /**
   * Initialize HTTP Range streaming (progressive download)
   */
  function initializeHttpRange() {
    if (!videoRef.current) return;

    const videoUrl = getVideoUrl("http-range", apiUrl, routeId);
    videoRef.current.src = videoUrl;
  }

  return {
    videoRef,
    error,
    hlsInstance,
    dashInstance,
  };
}
