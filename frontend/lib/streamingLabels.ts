import type { AbrAlgorithm, StreamingMethod } from "@/types/streaming";

/**
 * Get human-readable label for ABR algorithm
 */
export function getAbrLabel(algorithm: AbrAlgorithm): string {
  switch (algorithm) {
    case "hybrid":
      return "Hybrid";
    case "throughput":
      return "Throughput-Based";
    case "buffer":
      return "Buffer-Based (BOLA)";
    case "baseline":
      return "Non-Adaptive";
    default:
      return "Unknown";
  }
}

/**
 * Get streaming method description
 */
export function getStreamingMethodDescription(method: StreamingMethod): string {
  switch (method) {
    case "http-range":
      return "Traditional video delivery. Single quality, browser requests video chunks as needed. Simple but no quality adaptation.";
    case "hls":
      return "Apple's streaming protocol. Multiple quality levels, automatically adapts to network conditions. Used by YouTube, Twitch. Format: .m3u8 + .ts segments.";
    case "dash":
      return "Industry-standard streaming protocol (MPEG). Multiple quality levels, automatic adaptation. Used by Netflix, YouTube. Format: .mpd manifest + .m4s segments.";
  }
}

/**
 * Get ABR algorithm description
 */
export function getAbrDescription(algorithm: AbrAlgorithm): string {
  switch (algorithm) {
    case "hybrid":
      return "🔄 Hybrid: Balances bandwidth and buffer for optimal quality";
    case "throughput":
      return "📊 Throughput: Quality based on network speed estimation";
    case "buffer":
      return "📦 BOLA: Quality based on buffer occupancy levels";
    case "baseline":
      return "⚡ Baseline: Locks to highest quality (may stall on slow networks)";
  }
}

/**
 * Get DASH-specific ABR algorithm description
 */
export function getDashAbrDescription(algorithm: AbrAlgorithm): string {
  switch (algorithm) {
    case "hybrid":
      return "🔄 Dynamic: Modern hybrid approach combining multiple factors";
    case "throughput":
      return "📊 Throughput: Quality based on network speed only";
    case "buffer":
      return "📦 BOLA: Buffer Occupancy based Lyapunov Algorithm";
    case "baseline":
      return "⚡ Baseline: Forces highest quality (may cause buffering)";
  }
}

/**
 * Get streaming method title
 */
export function getStreamingMethodTitle(method: StreamingMethod): string {
  switch (method) {
    case "http-range":
      return "📹 HTTP Range Requests:";
    case "hls":
      return "🍎 HLS (Adaptive):";
    case "dash":
      return "🎬 DASH (Adaptive):";
  }
}

/**
 * Get active method display name
 */
export function getActiveMethodName(
  method: StreamingMethod,
  algorithm?: AbrAlgorithm,
): string {
  if (method === "http-range") {
    return "HTTP Range Requests";
  }

  const abrLabel = algorithm ? ` (${getAbrLabel(algorithm)})` : "";
  return method === "hls"
    ? `HLS Adaptive Streaming${abrLabel}`
    : `DASH Adaptive Streaming${abrLabel}`;
}

/**
 * Build manifest or video URL
 */
export function getVideoUrl(
  method: StreamingMethod,
  apiUrl: string,
  videoFileName: string,
): string {
  const videoId = videoFileName.replace(".mp4", "");

  switch (method) {
    case "http-range":
      return `${apiUrl}/api/httprange/${videoId}`;
    case "hls":
      return `${apiUrl}/api/hls/${videoId}/master.m3u8`;
    case "dash":
      return `${apiUrl}/api/dash/${videoId}/manifest.mpd`;
  }
}
