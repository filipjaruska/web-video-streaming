import Link from "next/link";
import { Film } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { getPublicApiUrl } from "@/lib/env";
import { fixed, signed } from "@/lib/results/format";
import { videoTitle, type VideoListItem } from "@/lib/videoApi";

/** Headline figures for a card, from the cached chapter 5 report. */
export interface VideoFigures {
  tiMean: number | null;
  animationBdRate: number | null;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-sm tabular">{value}</div>
    </div>
  );
}

/** Whether the video is packaged for a protocol; a missing one means that packaging failed. */
function DeliveryTag({ label, ready }: { label: string; ready: boolean }) {
  return (
    <span
      title={ready ? `Packaged for ${label}` : `Not packaged for ${label}`}
      className={
        ready
          ? "rounded-sm border border-success/40 bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success"
          : "rounded-sm border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground line-through"
      }
    >
      {label}
    </span>
  );
}

export function VideoList({
  videos,
  figures,
}: {
  videos: VideoListItem[];
  figures: Record<string, VideoFigures>;
}) {
  if (videos.length === 0) {
    return (
      <EmptyState title="No videos yet">Upload one with the button at the top right.</EmptyState>
    );
  }

  const apiUrl = getPublicApiUrl();

  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {videos.map((video, index) => {
        const figure = figures[video.routeId];
        return (
          <li
            key={video.routeId}
            className="animate-rise"
            style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
          >
            <Link href={`/${video.routeId}`} className="group block space-y-3">
              <div className="relative aspect-video overflow-hidden rounded-sm border bg-muted">
                {video.thumbnailUrl ? (
                  <img
                    src={`${apiUrl}${video.thumbnailUrl}`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                ) : (
                  <Film className="absolute inset-0 m-auto size-8 text-muted-foreground/40" />
                )}
                {video.status !== "ready" && (
                  <StatusBadge
                    status={video.status}
                    className="absolute top-2 left-2 bg-background/90 backdrop-blur"
                  />
                )}
              </div>
              <div className="space-y-1">
                <h2 className="truncate font-medium transition-colors group-hover:text-primary">
                  {videoTitle(video)}
                </h2>
                {video.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{video.description}</p>
                )}
              </div>
              <div className="flex items-end justify-between gap-4 border-t pt-2">
                {figure && (figure.tiMean != null || figure.animationBdRate != null) ? (
                  <div className="flex gap-6">
                    <Figure label="Mean TI" value={fixed(figure.tiMean)} />
                    <Figure
                      label="Animation-optimised BD-rate"
                      value={
                        figure.animationBdRate != null ? `${signed(figure.animationBdRate)} %` : "—"
                      }
                    />
                  </div>
                ) : (
                  <span />
                )}
                <div className="flex shrink-0 gap-1">
                  <DeliveryTag label="HLS" ready={video.hasHls} />
                  <DeliveryTag label="DASH" ready={video.hasDash} />
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
