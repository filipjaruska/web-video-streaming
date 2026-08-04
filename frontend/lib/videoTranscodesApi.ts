import type { AbrAlgorithm, StreamingMethod } from "@/types/streaming";
import { SOURCE_RUN_ID } from "@/types/streaming";

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

function pickDeliveryForLadder(
  item: VideoTranscodeListItem,
): StreamingMethod | null {
  if (item.hasHls) return "hls";
  if (item.hasDash) return "dash";
  return null;
}

/** Best-mode defaults: active packaging run + HLS preferred + hybrid ABR.
 * Prefer HLS over DASH: existing DASH packages often use multi-AS 5.1 audio
 * that Chrome MSE rejects (CHUNK_DEMUXER append failures).
 * Falls back to Source (original) when no ladder is playable.
 */
export function pickBestPlaybackSettings(
  transcodes: VideoTranscodeListItem[],
  activeTranscodeId: string | null,
): {
  packagingRunId: string;
  streamingMethod: StreamingMethod;
  abrAlgorithm: AbrAlgorithm;
} {
  const succeeded = transcodes.filter((item) => item.status === "succeeded");
  const active =
    succeeded.find((item) => item.id === activeTranscodeId) ??
    succeeded.find((item) => item.isActive) ??
    succeeded[succeeded.length - 1] ??
    null;

  if (active) {
    const delivery = pickDeliveryForLadder(active);
    if (delivery) {
      return {
        packagingRunId: active.id,
        streamingMethod: delivery,
        abrAlgorithm: "hybrid",
      };
    }
  }

  return {
    packagingRunId: SOURCE_RUN_ID,
    streamingMethod: "source",
    abrAlgorithm: "hybrid",
  };
}
