import { MetricTile, MetricTileGrid } from "@/components/metric-tiles";
import type { VideoQuality, VideoStats } from "@/types/streaming";

function formatCodec(codec?: string): string | null {
  if (!codec) return null;
  const lower = codec.toLowerCase();
  if (lower.includes("avc") || lower.includes("h264")) return "H.264";
  if (lower.includes("hev") || lower.includes("hvc") || lower.includes("h265")) return "H.265";
  if (lower.includes("vp09") || lower.includes("vp9")) return "VP9";
  if (lower.includes("av01") || lower.includes("av1")) return "AV1";
  return codec;
}

/**
 * "1920×1080 · H.264 · 7.80 Mb/s", the rendition on screen in one line. Parts not known yet are
 * left out rather than guessed. The bitrate is the one the stream declares (HLS/DASH: the rung's
 * peak including audio; source: the file's average).
 */
function describeRendition(quality: VideoQuality | null): string | undefined {
  if (!quality) return undefined;
  return [
    `${quality.width}×${quality.height}`,
    formatCodec(quality.codec),
    quality.bitrate > 0 ? `${(quality.bitrate / 1_000_000).toFixed(2)} Mb/s` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Live numbers from the player: what is on screen now, then the session so far. */
export function PlaybackStats({ stats }: { stats: VideoStats }) {
  const { current, average } = stats;
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Now</h2>
        <MetricTileGrid columns={4}>
          <MetricTile
            label="Rendition"
            value={current.quality?.label || "—"}
            title={describeRendition(current.quality)}
          />
          <MetricTile label="Buffer ahead" value={current.bufferLevel.toFixed(1)} unit="s" />
          <MetricTile label="Throughput" value={current.bandwidth.toFixed(2)} unit="Mb/s" />
          <MetricTile
            label="Dropped frames"
            value={current.droppedFrames}
            unit={`of ${current.totalFrames}`}
          />
        </MetricTileGrid>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">This session</h2>
        <MetricTileGrid columns={3}>
          <MetricTile label="Most played" value={average.avgQuality?.label || "—"} />
          <MetricTile label="Mean buffer" value={average.avgBufferLevel.toFixed(1)} unit="s" />
          <MetricTile label="Mean throughput" value={average.avgBandwidth.toFixed(2)} unit="Mb/s" />
          <MetricTile
            label="Dropped frames"
            value={average.avgDroppedFramesRate.toFixed(2)}
            unit="%"
          />
          <MetricTile
            label="Stalls"
            value={average.totalRebufferingEvents}
            unit={`${average.totalRebufferingDuration.toFixed(1)} s`}
          />
          <MetricTile label="Played" value={formatTime(average.totalPlaybackTime)} />
        </MetricTileGrid>
      </section>
    </div>
  );
}
