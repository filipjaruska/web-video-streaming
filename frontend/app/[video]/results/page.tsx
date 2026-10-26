import { ClipPlayback } from "@/feature/clip/clip-playback";
import { ClipResults } from "@/feature/clip/clip-results";
import { isProcessing } from "@/lib/clipLookup";
import { loadClipReport } from "@/lib/results/loadChapter5";

type ClipResultsPageProps = {
  params: Promise<{ video: string }>;
};

export default async function ClipResultsPage({ params }: ClipResultsPageProps) {
  const { video } = await params;
  // The playback tables need the run traces (megabytes), so they are reduced here; the charts
  // above them read the analysis in the browser and refresh while the clip is still processing.
  const report = await loadClipReport(video).catch(() => null);
  return (
    <ClipResults
      routeId={video}
      poll={await isProcessing(video)}
      report={report}
      playback={report ? <ClipPlayback report={report} routeId={video} /> : null}
    />
  );
}
