import { ErrorBanner } from "@/components/error-banner";
import { Section } from "@/components/section";
import { SavedBenchmarks } from "@/feature/video/saved-benchmarks";
import { VideoRaw } from "@/feature/video/video-raw";
import { getApiUrl } from "@/lib/env";
import { getVideoBenchmarks, type VideoBenchmarksResponse } from "@/lib/videoBenchmarksApi";
import { isProcessing } from "@/lib/videoLookup";

type VideoRawPageProps = {
  params: Promise<{ video: string }>;
};

export default async function VideoRawPage({ params }: VideoRawPageProps) {
  const { video } = await params;

  let saved: VideoBenchmarksResponse | null = null;
  let error: string | null = null;
  try {
    saved = await getVideoBenchmarks(getApiUrl(), video, {
      next: { revalidate: 60, tags: ["benchmarks"] },
    });
  } catch (err) {
    error = err instanceof Error ? err.message : "Saved runs could not be loaded.";
  }

  return (
    <div>
      <VideoRaw routeId={video} poll={await isProcessing(video)} />
      <Section id="benchmarks" title="Playback benchmark">
        {error && <ErrorBanner title="Saved runs unavailable" message={error} />}
        {saved && <SavedBenchmarks aggregates={saved.aggregates} runs={saved.runs} />}
      </Section>
    </div>
  );
}
