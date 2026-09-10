import { VideoList } from "@/components/video-list";
import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import { ErrorBanner } from "@/components/error-banner";
import { HomeHero } from "@/components/home-hero";
import { listVideos } from "@/lib/videoApi";
import { HOME_COPY } from "@/lib/siteCopy";

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
    <PageShell title={HOME_COPY.title} description={HOME_COPY.description}>
      <Separator className="mb-6" />
      <HomeHero />
      <h2 className="mb-4 text-xl font-semibold tracking-tight">Clips</h2>
      {error ? (
        <ErrorBanner title="Failed to load videos" message={error} />
      ) : (
        <VideoList videos={videos ?? []} />
      )}
    </PageShell>
  );
}
