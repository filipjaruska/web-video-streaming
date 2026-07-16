import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VideoStreamingClient } from "@/components/video-streaming-client";
import { PageShell } from "@/components/page-shell";
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
    const match = videos.find((v) => v.videoId === video);
    if (match) {
      return {
        title: match.fileName,
        description: `Stream ${match.fileName} with HTTP Range, HLS, and DASH protocols`,
      };
    }
  } catch {
    // Fall through to generic metadata
  }

  return {
    title: video,
    description:
      "Compare HTTP Range, HLS, and DASH streaming protocols with different ABR algorithms",
  };
}

export default async function VideoPage({ params }: VideoPageProps) {
  const { video } = await params;

  try {
    const { videos } = await listVideos();
    if (!videos.some((v) => v.videoId === video)) {
      notFound();
    }
  } catch {
    // If the catalog is unreachable, still render the player shell
  }

  const videoFileName = `${video}.mp4`;

  return (
    <PageShell
      title={video}
      description="Compare HTTP Range, HLS, and DASH streaming protocols with different ABR algorithms"
      actionLabel="Display Analysis"
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
              <BreadcrumbPage>{videoFileName}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <Separator className="mb-6" />
      <VideoStreamingClient videoFileName={videoFileName} />
    </PageShell>
  );
}
