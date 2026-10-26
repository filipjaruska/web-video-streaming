import { ErrorBanner } from "@/components/error-banner";
import { VideoStreamingClient } from "@/components/video-streaming-client";
import { SavedBenchmarks } from "@/feature/clip/saved-benchmarks";
import { getApiUrl } from "@/lib/env";
import { getVideoBenchmarks, type VideoBenchmarksResponse } from "@/lib/videoBenchmarksApi";

type BenchmarkPageProps = {
  params: Promise<{ video: string }>;
};

export default async function BenchmarkPage({ params }: BenchmarkPageProps) {
  const { video } = await params;

  let saved: VideoBenchmarksResponse | null = null;
  let error: string | null = null;
  try {
    saved = await getVideoBenchmarks(getApiUrl(), video, {
      next: { revalidate: 60, tags: ["benchmarks"] },
    });
  } catch (err) {
    error = err instanceof Error ? err.message : "Saved results could not be loaded.";
  }

  return (
    <div className="space-y-12">
      <VideoStreamingClient routeId={video} mode="benchmark" />
      <section className="border-t pt-8">
        {error && <ErrorBanner title="Saved results unavailable" message={error} />}
        {saved && <SavedBenchmarks aggregates={saved.aggregates} runs={saved.runs} />}
      </section>
    </div>
  );
}
