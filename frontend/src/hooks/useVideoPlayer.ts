import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import * as dashjs from "dashjs";
import type { AbrAlgorithm, StreamingMethod } from "../types/streaming";
import { createHlsConfig, createDashSettings } from "../utils/streamingConfig";
import { getVideoUrl } from "../utils/streamingLabels";

interface UseVideoPlayerProps {
  streamingMethod: StreamingMethod;
  abrAlgorithm: AbrAlgorithm;
  apiUrl: string;
  videoFileName: string;
}

/**
 * Custom hook for managing video player instances and streaming
 * Handles HLS, DASH, and HTTP Range streaming methods with ABR configuration
 */
export function useVideoPlayer({
  streamingMethod,
  abrAlgorithm,
  apiUrl,
  videoFileName,
}: UseVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
  const [dashInstance, setDashInstance] =
    useState<dashjs.MediaPlayerClass | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    setError(null);

    // Clean up existing instances
    cleanupInstances();

    // Initialize based on streaming method
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
  }, [streamingMethod, abrAlgorithm, apiUrl, videoFileName]);

  /**
   * Clean up any existing player instances
   */
  function cleanupInstances() {
    if (hlsInstance) {
      hlsInstance.destroy();
      setHlsInstance(null);
    }
    if (dashInstance) {
      dashInstance.reset();
      setDashInstance(null);
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
      const hlsUrl = getVideoUrl("hls", apiUrl, videoFileName);

      hls.loadSource(hlsUrl);
      hls.attachMedia(videoRef.current);

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
      videoRef.current.src = getVideoUrl("hls", apiUrl, videoFileName);
    } else {
      setError(
        "HLS is not supported in this browser. Please use a modern browser like Google Chrome or a Chromium-based alternative.",
      );
    }
  }

  /**
   * Initialize DASH streaming
   */
  function initializeDash() {
    if (!videoRef.current) return;

    const dash = dashjs.MediaPlayer().create();
    const dashSettings = createDashSettings(abrAlgorithm);
    const dashUrl = getVideoUrl("dash", apiUrl, videoFileName);

    dash.updateSettings(dashSettings);
    dash.initialize(videoRef.current, dashUrl, false);

    // Handle errors
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    videoRef.current.src = getVideoUrl("http-range", apiUrl, videoFileName);
  }

  return {
    videoRef,
    error,
    hlsInstance,
    dashInstance,
  };
}
