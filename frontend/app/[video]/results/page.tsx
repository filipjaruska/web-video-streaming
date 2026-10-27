import { Suspense } from "react";

import { VideoResultsSkeleton } from "@/feature/video/video-results";

import { ResultsContent } from "./results-content";

type VideoResultsPageProps = {
  params: Promise<{ video: string }>;
};

export default function VideoResultsPage({ params }: VideoResultsPageProps) {
  return (
    <Suspense fallback={<VideoResultsSkeleton />}>
      <ResultsContent params={params} />
    </Suspense>
  );
}
