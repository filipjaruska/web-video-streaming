/**
 * What this browser can actually play.
 *
 * Deliberately dependency-free: `Hls.isSupported()` is an MSE plus codec check and nothing more,
 * so reimplementing it here keeps this module a pure feature probe that can be imported anywhere
 * without pulling hls.js into the bundle.
 *
 * Everything is probed lazily inside the function — no `window`, no `document` and no element
 * creation at module scope — so importing this from a server-rendered module is safe.
 */
export interface PlaybackCapabilities {
  /** Standard Media Source Extensions. Absent on iOS Safari before 17. */
  mediaSource: boolean;
  /** Apple's constrained MSE, the iOS 17+ path for hls.js and dash.js. */
  managedMediaSource: boolean;
  /** The browser can play an HLS playlist natively, without any JS library. */
  nativeHls: boolean;
  /** H.264 baseline is playable through MSE — everything this project packages is AVC. */
  avcInMse: boolean;
  aacInMse: boolean;
  /** hls.js can drive this browser. */
  mseHls: boolean;
  /** dash.js can drive this browser. It has no native fallback anywhere. */
  dash: boolean;
}

const AVC_MIME = 'video/mp4; codecs="avc1.42E01E"';
const AAC_MIME = 'audio/mp4; codecs="mp4a.40.2"';
const HLS_MIME = "application/vnd.apple.mpegurl";

type MseLike = { isTypeSupported?: (type: string) => boolean };

function supportsType(source: MseLike | undefined, mime: string): boolean {
  try {
    return source?.isTypeSupported?.(mime) === true;
  } catch {
    return false;
  }
}

/**
 * Probes the current browser. Returns null on the server, so callers can render a neutral state
 * rather than guessing and then correcting themselves after hydration.
 */
export function detectPlaybackCapabilities(): PlaybackCapabilities | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  const globalWithMse = window as unknown as {
    MediaSource?: MseLike;
    ManagedMediaSource?: MseLike;
  };

  const mediaSource = typeof globalWithMse.MediaSource !== "undefined";
  const managedMediaSource = typeof globalWithMse.ManagedMediaSource !== "undefined";

  // `canPlayType` answers "" | "maybe" | "probably"; "" is the only definite no.
  let nativeHls = false;
  try {
    const probe = document.createElement("video");
    nativeHls = probe.canPlayType(HLS_MIME) !== "";
  } catch {
    nativeHls = false;
  }

  const source = globalWithMse.MediaSource ?? globalWithMse.ManagedMediaSource;
  const avcInMse = supportsType(source, AVC_MIME);
  const aacInMse = supportsType(source, AAC_MIME);

  return {
    mediaSource,
    managedMediaSource,
    nativeHls,
    avcInMse,
    aacInMse,
    mseHls: (mediaSource || managedMediaSource) && avcInMse,
    // dash.js has no native path — without full MSE there is nothing to fall back to.
    dash: mediaSource && avcInMse,
  };
}
