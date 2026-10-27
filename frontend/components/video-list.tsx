import { Suspense } from "react";
import Link from "next/link";
import { Check, Film, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { getPublicApiUrl } from "@/lib/env";
import { fixed, signed } from "@/lib/results/format";
import { videoTitle, type VideoListItem } from "@/lib/videoApi";

/** Headline figures for a card, from the cached chapter 5 report. */
export interface VideoFigures {
  tiMean: number | null;
  animationBdRate: number | null;
  /** What kept the video from going through the pipeline cleanly; empty when nothing did. */
  issues: string[];
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-sm tabular">{value}</div>
    </div>
  );
}

/**
 * Whether a processed video went through the whole pipeline: packaged for HLS and DASH, all of
 * its data loadable, and both derived ladders compared. Processing and failed videos carry their
 * status badge on the thumbnail instead.
 */
function PipelineBadge({ video, issues }: { video: VideoListItem; issues: string[] }) {
  const problems = [
    ...(video.hasHls ? [] : ["Not packaged for HLS."]),
    ...(video.hasDash ? [] : ["Not packaged for DASH."]),
    ...issues,
  ];
  if (problems.length === 0) {
    return (
      <Hint content="Analysed, packaged for HLS and DASH, and compared without errors.">
        <span className="inline-flex items-center gap-1 rounded-sm border border-success/40 bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">
          <Check className="size-3" strokeWidth={3} />
          OK
        </span>
      </Hint>
    );
  }
  return (
    <Hint content={problems.join(" ")}>
      <span className="inline-flex items-center gap-1 rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
        <TriangleAlert className="size-3" />
        Check
      </span>
    </Hint>
  );
}

async function CardFigures({
  video,
  figures,
}: {
  video: VideoListItem;
  figures: Promise<Record<string, VideoFigures>>;
}) {
  const figure = (await figures)[video.routeId];
  return (
    <>
      {figure && (figure.tiMean != null || figure.animationBdRate != null) ? (
        <div className="flex gap-6">
          <Figure label="Mean TI" value={fixed(figure.tiMean)} />
          <Figure
            label="Animation-optimised BD-rate"
            value={figure.animationBdRate != null ? `${signed(figure.animationBdRate)} %` : "—"}
          />
        </div>
      ) : (
        <span />
      )}
      {video.status === "ready" && figure && <PipelineBadge video={video} issues={figure.issues} />}
    </>
  );
}

/** Holds the figures' place, at their height, so the cards do not move when they arrive. */
function CardFiguresSkeleton() {
  return (
    <div className="flex gap-6">
      <Skeleton className="h-9 w-14" />
      <Skeleton className="h-9 w-40" />
    </div>
  );
}

/**
 * The catalogue. The cards render at once; their figures come from the report over every video,
 * which takes a few seconds to build when it is not cached, so they stream in.
 */
export function VideoList({
  videos,
  figures,
}: {
  videos: VideoListItem[];
  figures: Promise<Record<string, VideoFigures>>;
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
                <h2 className="truncate font-medium transition-colors group-hover:text-primary-ink">
                  {videoTitle(video)}
                </h2>
                {video.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{video.description}</p>
                )}
              </div>
              <div className="flex min-h-11 items-end justify-between gap-4 border-t pt-2">
                <Suspense fallback={<CardFiguresSkeleton />}>
                  <CardFigures video={video} figures={figures} />
                </Suspense>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
