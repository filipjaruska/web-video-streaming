import { ErrorBanner } from "@/components/error-banner";
import { PageShell } from "@/components/page-shell";
import { VideoList, type ClipFigures } from "@/components/video-list";
import { loadChapter5 } from "@/lib/results/loadChapter5";
import { HOME_COPY } from "@/lib/siteCopy";
import { listVideos, type VideoListItem } from "@/lib/videoApi";

async function headlineFigures(): Promise<Record<string, ClipFigures>> {
  // The figures are a bonus on the cards; the catalogue renders without them.
  const report = await loadChapter5().catch(() => null);
  if (!report) {
    return {};
  }
  return Object.fromEntries(
    report.content.map((row, index) => [
      row.routeId,
      {
        tiMean: row.tiMean,
        animationBdRate: report.ladders[index]?.ladders.animation?.bdRate ?? null,
      },
    ]),
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
