import type { AbrAlgorithm, StreamingMethod } from "@/types/streaming";
import { SOURCE_RUN_ID } from "@/types/streaming";
import type { LadderKind } from "@/lib/analysisFormat";
import type { PlaybackCapabilities } from "@/lib/playbackCapabilities";

/**
 * Re-exported for call sites that already import from here. The three tokens are produced by
 * `AnalysisTargetBuilder.LadderToken` on the backend; this union previously omitted `"animation"`,
 * which made the animation-tuned run render as "Static" wherever it was matched with a ternary.
 */
export type TranscodeLadderKind = LadderKind;

export interface VideoTranscodeListItem {
  id: string;
  ladderKind: TranscodeLadderKind;
  label: string;
  hasHls: boolean;
  hasDash: boolean;
  isActive: boolean;
  status: string;
  createdAtUtc: string;
  /** Packaging window for this run. Absent on runs recorded before these were exposed. */
  startedAtUtc?: string | null;
  completedAtUtc?: string | null;
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

export interface BestPlaybackSettings {
  packagingRunId: string;
  streamingMethod: StreamingMethod;
  abrAlgorithm: AbrAlgorithm;
  /** Why this protocol was chosen, in a form that can be shown to the user. */
  reason: string;
}

/**
 * Picks the delivery protocol for one packaged ladder, given what the browser supports.
 *
 * Order matters. Native HLS comes first because on Safari and iOS it plays without MSE at all,
 * which is the only path available there before iOS 17. MSE-driven HLS is next: hls.js is the
 * better-tested path here, and existing DASH packages sometimes carry multi-adaptation-set 5.1
 * audio that Chrome's MSE rejects with CHUNK_DEMUXER append failures.
 *
 * With no capability probe yet — server render, or the first frame before the effect runs — this
 * falls through to the availability-only branch, which is exactly the behaviour that shipped
 * before capabilities existed. Nothing changes until the probe lands.
 */
function pickDeliveryForLadder(
  item: VideoTranscodeListItem,
  capabilities?: PlaybackCapabilities | null,
): { method: StreamingMethod; reason: string } | null {
  if (capabilities) {
    if (item.hasHls && capabilities.nativeHls) {
      return { method: "hls", reason: "HLS — native playback, no MSE needed" };
    }

    if (item.hasHls && capabilities.mseHls) {
      return {
        method: "hls",
        reason: capabilities.managedMediaSource && !capabilities.mediaSource
          ? "HLS via hls.js — ManagedMediaSource"
          : "HLS via hls.js — MSE available",
      };
    }

    if (item.hasDash && capabilities.dash) {
      return { method: "dash", reason: "DASH — MSE available, no native HLS" };
    }
  }

  if (item.hasHls) {
    return { method: "hls", reason: "HLS — default, capabilities not probed" };
  }

  if (item.hasDash) {
    return { method: "dash", reason: "DASH — only packaging available" };
  }

  return null;
}

/**
 * Best-mode defaults: the active packaging run, the protocol this browser handles best, hybrid
 * ABR. Falls back to the original source over HTTP Range when no ladder is playable.
 */
export function pickBestPlaybackSettings(
  transcodes: VideoTranscodeListItem[],
  activeTranscodeId: string | null,
  capabilities?: PlaybackCapabilities | null,
): BestPlaybackSettings {
  const succeeded = transcodes.filter((item) => item.status === "succeeded");
  const active =
    succeeded.find((item) => item.id === activeTranscodeId) ??
    succeeded.find((item) => item.isActive) ??
    succeeded[succeeded.length - 1] ??
    null;

  if (active) {
    const delivery = pickDeliveryForLadder(active, capabilities);
    if (delivery) {
      return {
        packagingRunId: active.id,
        streamingMethod: delivery.method,
        abrAlgorithm: "hybrid",
        reason: delivery.reason,
      };
    }
  }

  return {
    packagingRunId: SOURCE_RUN_ID,
    streamingMethod: "source",
    abrAlgorithm: "hybrid",
    reason: "Progressive HTTP Range — no packaged ladder available",
  };
}
