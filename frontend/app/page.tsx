import { VideoList } from "@/components/video-list";
import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import { ErrorBanner } from "@/components/error-banner";
import { listVideos } from "@/lib/videoApi";

export default async function Home() {
  let videos = null;
  let error: string | null = null;

  try {
    const data = await listVideos();
    videos = data.videos;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load videos";
  }

  return (
    <PageShell
      title="Video Streaming Demo"
      description="Explore different video streaming protocols and ABR algorithms"
    >
      <Separator className="mb-6" />
      {error ? (
        <ErrorBanner title="Failed to load videos" message={error} />
      ) : (
        <VideoList videos={videos ?? []} />
      )}
    </PageShell>
  );
}
