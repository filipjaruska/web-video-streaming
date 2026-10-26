import { ErrorBanner } from "@/components/error-banner";
import { PageShell } from "@/components/page-shell";
import { VideoList, type VideoFigures } from "@/components/video-list";
import { loadChapter5 } from "@/lib/results/loadChapter5";
import { HOME_COPY } from "@/lib/siteCopy";
import { listVideos, type VideoListItem } from "@/lib/videoApi";

async function headlineFigures(): Promise<Record<string, VideoFigures>> {
  // The figures are a bonus on the cards; the catalogue renders without them.
  const report = await loadChapter5().catch(() => null);
  if (!report) {
    return {};
  }
  // The report's rows share one order, so a video's rows sit at the same index in each.
  return Object.fromEntries(
    report.content.map((row, index) => {
      const video = report.videos[index];
      const ladders = report.ladders[index]?.ladders;
      const issues = [
        ...(video?.errors ?? []),
        ...(video && !video.complete ? ["The ladder comparison has not been written."] : []),
        ...(ladders?.dynamic?.error ? [`Content-adaptive: ${ladders.dynamic.error}`] : []),
        ...(ladders?.animation?.error ? [`Animation-optimised: ${ladders.animation.error}`] : []),
      ];
      return [
        row.routeId,
        { tiMean: row.tiMean, animationBdRate: ladders?.animation?.bdRate ?? null, issues },
      ];
    }),
  );
}

async function catalogue(): Promise<{ videos: VideoListItem[]; error: string | null }> {
  try {
    return { videos: (await listVideos()).videos, error: null };
  } catch (err) {
    return {
      videos: [],
      error: err instanceof Error ? err.message : "The catalogue could not be loaded.",
    };
  }
}

export default async function Home() {
  const [{ videos, error }, figures] = await Promise.all([catalogue(), headlineFigures()]);

  return (
    <PageShell title={HOME_COPY.title} description={HOME_COPY.description}>
      {error ? (
        <ErrorBanner title="Catalogue unavailable" message={error} />
      ) : (
        <VideoList videos={videos} figures={figures} />
      )}
    </PageShell>
  );
}
