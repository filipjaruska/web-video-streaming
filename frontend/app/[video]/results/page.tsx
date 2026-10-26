import { VideoPlayback } from "@/feature/video/video-playback";
import { VideoResults } from "@/feature/video/video-results";
import { isProcessing } from "@/lib/videoLookup";
import { loadVideoReport } from "@/lib/results/loadChapter5";

type VideoResultsPageProps = {
  params: Promise<{ video: string }>;
};

export default async function VideoResultsPage({ params }: VideoResultsPageProps) {
  const { video } = await params;
  // The playback tables need the run traces (megabytes), so they are reduced here; the charts
  // above them read the analysis in the browser and refresh while the video is still processing.
  const report = await loadVideoReport(video).catch(() => null);
  return (
    <VideoResults
      routeId={video}
      poll={await isProcessing(video)}
      report={report}
      playback={report ? <VideoPlayback report={report} routeId={video} /> : null}
    />
  );
}
