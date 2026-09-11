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
 * Order matters, and it follows what the player actually does. hls.js comes first wherever MSE
 * exists: Vidstack prefers it over the browser's own HLS (`preferNativeHLS` is false), and only
 * through hls.js do the rules in `lib/abr` choose the quality — native playback hands that choice to
 * the browser. Native HLS is the fallback for browsers without MSE, which on iOS before 17 is the
 * only path there is. This used to check native HLS first, and since Chrome started answering
 * `canPlayType` for HLS, every Chrome session was labelled "native" while playing through hls.js.
 * DASH comes last: it needs MSE too, so it only wins when the ladder has no HLS package.
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
    if (item.hasHls && capabilities.mseHls) {
      return {
        method: "hls",
        reason: capabilities.managedMediaSource && !capabilities.mediaSource
          ? "HLS via hls.js — ManagedMediaSource"
          : "HLS via hls.js — MSE available",
      };
    }

    if (item.hasHls && capabilities.nativeHls) {
      return { method: "hls", reason: "HLS — native playback, no MSE available" };
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
 * Best-mode defaults: the active packaging run, the protocol this browser handles best, and the
 * throughput rule behind a fast start. Falls back to the original source over HTTP Range when no
 * ladder is playable.
 *
 * Throughput rather than hybrid: hybrid takes the more cautious of the throughput and buffer rules,
 * and the buffer rule only climbs as the buffer fills — the right conservatism for a measured
 * profile, but a viewer on a fast link would watch the first segments at the bottom of the ladder.
 * Best mode is never part of the measurement matrix, so it is free to optimise for first impression.
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
        abrAlgorithm: "throughput",
        reason: delivery.reason,
      };
    }
  }

  return {
    packagingRunId: SOURCE_RUN_ID,
    streamingMethod: "source",
    abrAlgorithm: "throughput",
    reason: "Progressive HTTP Range — no packaged ladder available",
  };
}
