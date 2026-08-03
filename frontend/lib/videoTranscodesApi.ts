import type { AbrAlgorithm, StreamingMethod } from "@/types/streaming";

export type TranscodeLadderKind = "static" | "dynamic";

export interface VideoTranscodeListItem {
  id: string;
  ladderKind: TranscodeLadderKind;
  label: string;
  hasHls: boolean;
  hasDash: boolean;
  isActive: boolean;
  status: string;
  createdAtUtc: string;
}

export interface VideoTranscodesResponse {
  activeTranscodeId: string | null;
  transcodes: VideoTranscodeListItem[];
}

export async function getVideoTranscodes(
  apiUrl: string,
  routeId: string,
): Promise<VideoTranscodesResponse> {
  const res = await fetch(`${apiUrl}/api/videos/${routeId}/transcodes`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to load transcodes: ${res.status}`);
  }

  return res.json() as Promise<VideoTranscodesResponse>;
}

/** Best-mode defaults: active packaging run + HLS/DASH/Range + hybrid ABR.
 * Prefer HLS over DASH: existing DASH packages often use multi-AS 5.1 audio
 * that Chrome MSE rejects (CHUNK_DEMUXER append failures).
 */
export function pickBestPlaybackSettings(
  transcodes: VideoTranscodeListItem[],
  activeTranscodeId: string | null,
): {
  transcodeId: string | null;
  streamingMethod: StreamingMethod;
  abrAlgorithm: AbrAlgorithm;
} {
  const succeeded = transcodes.filter((item) => item.status === "succeeded");
  const active =
    succeeded.find((item) => item.id === activeTranscodeId) ??
    succeeded.find((item) => item.isActive) ??
    succeeded[succeeded.length - 1] ??
    null;

  if (!active) {
    return {
      transcodeId: null,
      streamingMethod: "http-range",
      abrAlgorithm: "hybrid",
    };
  }

  let streamingMethod: StreamingMethod = "http-range";
  if (active.hasHls) {
    streamingMethod = "hls";
  } else if (active.hasDash) {
    streamingMethod = "dash";
  }

  return {
    transcodeId: active.id,
    streamingMethod,
    abrAlgorithm: "hybrid",
  };
}
