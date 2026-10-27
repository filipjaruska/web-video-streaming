import { connection } from "next/server";

import { ErrorBanner } from "@/components/error-banner";
import { PageShell } from "@/components/page-shell";
import { VideoList, type VideoFigures } from "@/components/video-list";
import { loadCatalogue, loadChapter5, perRequest } from "@/lib/serverCache";
import { HOME_COPY } from "@/lib/siteCopy";
import type { VideoListItem } from "@/lib/videoApi";

async function headlineFigures(): Promise<Record<string, VideoFigures>> {
  // Rendered per request, from the cache, rather than prerendered into the page. In the page, every
  // analysis or benchmark write would expire the whole of it, and the next visitor would wait for
  // the report (seconds when cold) before seeing any card. Out of it, the cards stay static and
  // only the figures wait.
  await connection();
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
    return { videos: (await loadCatalogue()).videos, error: null };
  } catch (err) {
    return perRequest({
      videos: [],
      error: err instanceof Error ? err.message : "The catalogue could not be loaded.",
    });
  }
}

export default async function Home() {
  // Started together, but only the catalogue is waited for: the figures stream into the cards.
  const figures = headlineFigures();
  const { videos, error } = await catalogue();

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
