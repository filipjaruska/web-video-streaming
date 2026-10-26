import { VideoPlayback } from "@/feature/video/video-playback";
import { VideoResults } from "@/feature/video/video-results";
import { isProcessing } from "@/lib/videoLookup";
import { loadVideoReport } from "@/lib/results/loadChapter5";
import { loadSlimAnalysis } from "@/lib/results/loadVideoAnalysis";

type VideoResultsPageProps = {
  params: Promise<{ video: string }>;
};

export default async function VideoResultsPage({ params }: VideoResultsPageProps) {
  const { video } = await params;
  // Both reduced and cached here: the playback tables need the run traces and the charts the
  // analysis, megabytes each. The browser fetches the analysis only while the video is processing.
  const [report, analysis, poll] = await Promise.all([
    loadVideoReport(video).catch(() => null),
    loadSlimAnalysis(video).catch(() => null),
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
