import type { AbrAlgorithm, StreamingMethod } from "@/types/streaming";

/** The ABR rules by the names the thesis uses. */
export function getAbrLabel(algorithm: AbrAlgorithm): string {
  switch (algorithm) {
    case "hybrid":
      return "Hybrid";
    case "throughput":
      return "Throughput";
    case "buffer":
      return "Buffer (BOLA)";
    case "baseline":
      return "Baseline (top rung)";
    default:
      return "Unknown";
  }
}
/**
 * Build manifest or video URL for a published video route id.
 * When `transcodeId` is set, HLS/DASH hit the packaging-run-scoped routes.
 * Source always uses the progressive Range endpoint for the original file.
 */
export function getVideoUrl(
  method: StreamingMethod,
  apiUrl: string,
  routeId: string,
  transcodeId?: string | null,
): string {
  switch (method) {
    case "source":
      return `${apiUrl}/api/httprange/${routeId}`;
    case "hls":
      return transcodeId
        ? `${apiUrl}/api/hls/${routeId}/t/${transcodeId}/master.m3u8`
        : `${apiUrl}/api/hls/${routeId}/master.m3u8`;
    case "dash":
      return transcodeId
        ? `${apiUrl}/api/dash/${routeId}/t/${transcodeId}/manifest.mpd`
        : `${apiUrl}/api/dash/${routeId}/manifest.mpd`;
  }
}

/** Direct media playlist for a single HLS ladder rung (e.g. 360p). */
export function getHlsVariantUrl(
  apiUrl: string,
  routeId: string,
  quality: string,
  transcodeId?: string | null,
): string {
  return transcodeId
    ? `${apiUrl}/api/hls/${routeId}/t/${transcodeId}/${quality}.m3u8`
    : `${apiUrl}/api/hls/${routeId}/${quality}.m3u8`;
}
