import { VideoPlayback } from "@/feature/video/video-playback";
import { VideoResults } from "@/feature/video/video-results";
import { isProcessing } from "@/lib/videoLookup";
import { loadSlimAnalysis, loadVideoReport, perRequest } from "@/lib/serverCache";

type VideoResultsPageProps = {
  params: Promise<{ video: string }>;
};

export default async function VideoResultsPage({ params }: VideoResultsPageProps) {
  const { video } = await params;
  // Both reduced and cached here: the playback tables need the run traces and the charts the
  // analysis, megabytes each. The browser fetches the analysis only while the video is processing.
  const [report, analysis, poll] = await Promise.all([
    loadVideoReport(video).catch(() => perRequest(null)),
    loadSlimAnalysis(video).catch(() => perRequest(null)),
    isProcessing(video),
  ]);
  return (
    <VideoResults
      routeId={video}
      poll={poll}
      initial={analysis}
      report={report}
      playback={report ? <VideoPlayback report={report} routeId={video} /> : null}
    />
  );
}
