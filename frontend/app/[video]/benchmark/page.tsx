import { ErrorBanner } from "@/components/error-banner";
import { VideoStreamingClient } from "@/components/video-streaming-client";
import { SavedRunsSummary } from "@/feature/video/saved-runs-summary";
import { loadVideoBenchmarks } from "@/lib/serverCache";
import type { VideoBenchmarksResponse } from "@/lib/videoBenchmarksApi";

type BenchmarkPageProps = {
  params: Promise<{ video: string }>;
};

export default async function BenchmarkPage({ params }: BenchmarkPageProps) {
  const { video } = await params;

  let saved: VideoBenchmarksResponse | null = null;
  let error: string | null = null;
  try {
    saved = await loadVideoBenchmarks(video);
  } catch (err) {
    error = err instanceof Error ? err.message : "Saved runs could not be loaded.";
  }

  return (
    <div className="space-y-12">
      <VideoStreamingClient routeId={video} mode="benchmark" />
      <section className="border-t pt-8">
        {error && <ErrorBanner title="Saved runs unavailable" message={error} />}
        {saved && <SavedRunsSummary routeId={video} runs={saved.runs} />}
      </section>
    </div>
  );
}
