"use client";

import type { VideoQuality, StreamingMethod } from "@/types/streaming";
import { Badge } from "@/components/ui/badge";

interface VideoEncodingInfoProps {
  quality: VideoQuality | null;
  streamingMethod: StreamingMethod;
}

function formatLabel(method: StreamingMethod): string {
  switch (method) {
    case "hls":
      return "HLS";
    case "dash":
      return "DASH";
    case "http-range":
      return "HTTP Range";
  }
}

function formatCodec(codec?: string): string {
  if (!codec) return "—";
  const lower = codec.toLowerCase();
  if (lower.includes("avc") || lower.includes("h264")) return "H.264";
  if (lower.includes("hev") || lower.includes("h265") || lower.includes("hevc"))
    return "H.265";
  if (lower.includes("vp9")) return "VP9";
  if (lower.includes("av01") || lower.includes("av1")) return "AV1";
  return codec;
}

export function VideoEncodingInfo({
  quality,
  streamingMethod,
}: VideoEncodingInfoProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Stream
      </span>
      <Badge variant="outline">{formatLabel(streamingMethod)}</Badge>
      <Badge variant="outline">
        {quality
          ? `${quality.width}×${quality.height} (${quality.label})`
          : "—"}
      </Badge>
      <Badge variant="outline" className="font-mono">
        {quality ? `${(quality.bitrate / 1_000_000).toFixed(2)} Mbps` : "—"}
      </Badge>
      <Badge variant="outline">{formatCodec(quality?.codec)}</Badge>
    </div>
  );
}
