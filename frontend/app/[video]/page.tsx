import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VideoStreamingClient } from "@/components/video-streaming-client";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { listVideos } from "@/lib/videoApi";

type VideoPageProps = {
  params: Promise<{ video: string }>;
};

export async function generateMetadata({
  params,
}: VideoPageProps): Promise<Metadata> {
  const { video } = await params;

  try {
    const { videos } = await listVideos();
    const match = videos.find((v) => v.routeId === video);
    if (match) {
      const label = match.title || match.fileName;
      return {
        title: label,
        description: `Watch ${label}`,
      };
    }
  } catch {
    // Fall through to generic metadata
  }

  return {
    title: video,
    description: "Watch video with Best or manual streaming settings",
  };
}

export default async function VideoPage({ params }: VideoPageProps) {
  const { video } = await params;

  let displayName = video;
  try {
    const { videos } = await listVideos();
    const match = videos.find((v) => v.routeId === video);
    if (!match) {
      notFound();
    }
    displayName = match.title || match.fileName || video;
  } catch {
    // If the catalog is unreachable, still render the player shell
  }

  return (
    <PageShell
      title={displayName}
      action={
        <Button asChild className="shrink-0 self-center">
          <Link href={`/${video}/analysis`}>Analysis</Link>
        </Button>
      }
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/">Videos</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{displayName}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <Separator className="mb-6" />
      <VideoStreamingClient routeId={video} />
    </PageShell>
  );
}
