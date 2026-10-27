import { ErrorBanner } from "@/components/error-banner";
import { Section } from "@/components/section";
import { SectionIndex } from "@/components/section-index";
import { SavedBenchmarks } from "@/feature/video/saved-benchmarks";
import { VideoRaw } from "@/feature/video/video-raw";
import { loadVideoBenchmarks } from "@/lib/serverCache";
import type { VideoBenchmarksResponse } from "@/lib/videoBenchmarksApi";
import { isProcessing } from "@/lib/videoLookup";

const RAW_SECTIONS = [
  { id: "source", title: "Source" },
  { id: "packaging", title: "Packaging runs" },
  { id: "benchmarks", title: "Playback benchmark" },
];

type VideoRawPageProps = {
  params: Promise<{ video: string }>;
};

export default async function VideoRawPage({ params }: VideoRawPageProps) {
  const { video } = await params;

  let saved: VideoBenchmarksResponse | null = null;
  let error: string | null = null;
  try {
    saved = await loadVideoBenchmarks(video);
  } catch (err) {
    error = err instanceof Error ? err.message : "Saved runs could not be loaded.";
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 xl:grid-cols-[15rem_minmax(0,1fr)]">
      <SectionIndex sections={RAW_SECTIONS} />
      <div>
        <VideoRaw routeId={video} poll={await isProcessing(video)} />
        <Section id="benchmarks" title="Playback benchmark">
          {error && <ErrorBanner title="Saved runs unavailable" message={error} />}
          {saved && <SavedBenchmarks aggregates={saved.aggregates} runs={saved.runs} />}
        </Section>
      </div>
    </div>
  );
}
