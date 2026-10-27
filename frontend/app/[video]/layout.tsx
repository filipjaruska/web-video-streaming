import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageShell } from "@/components/page-shell";
import { StatusBadge } from "@/components/status-badge";
import { DownloadRawData } from "@/feature/video/download-raw-data";
import { VideoManageMenu } from "@/feature/video/video-manage-menu";
import { VideoTabs } from "@/feature/video/video-tabs";
import { videoTitle } from "@/lib/videoApi";
import { loadCatalogue } from "@/lib/serverCache";
import { findVideo } from "@/lib/videoLookup";

type VideoLayoutProps = {
  params: Promise<{ video: string }>;
  children: ReactNode;
};

/** Stands in when there is nothing to list; no route id has this form, so it renders the 404. */
const PLACEHOLDER = "__placeholder__";

/**
 * Every video's tabs are built ahead of time. A video that is not listed here, one uploaded since
 * the build, gets the shell on its first visit and is then rendered and kept like the rest. Cache
 * Components needs at least one entry, so an empty catalogue, or a build that cannot reach the
 * backend, lists the placeholder.
 */
export async function generateStaticParams(): Promise<{ video: string }[]> {
  const videos = await loadCatalogue().then(
    (catalogue) => catalogue.videos,
    () => [],
  );
  return videos.length > 0
    ? videos.map((video) => ({ video: video.routeId }))
    : [{ video: PLACEHOLDER }];
}

export async function generateMetadata({
  params,
}: Pick<VideoLayoutProps, "params">): Promise<Metadata> {
  const { video: routeId } = await params;
  const video = await findVideo(routeId);
  const title = video ? videoTitle(video) : routeId;
  return { title, description: video?.description ?? `Playback and results for ${title}` };
}

export default async function VideoLayout({ params, children }: VideoLayoutProps) {
  const { video: routeId } = await params;
  const video = await findVideo(routeId);
  if (video === null) {
    notFound();
  }

  return (
    <PageShell
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {video ? videoTitle(video) : routeId}
          {video && video.status !== "ready" && <StatusBadge status={video.status} />}
        </span>
      }
      description={video?.description ?? undefined}
      actions={
        video ? (
          <>
            <DownloadRawData video={video} />
            <VideoManageMenu video={video} />
          </>
        ) : undefined
      }
      below={<VideoTabs routeId={routeId} />}
    >
      <div className="pt-6">{children}</div>
    </PageShell>
  );
}
