import { PageShell } from "@/components/page-shell";
import { VideoListSkeleton } from "@/components/video-list-skeleton";
import { HOME_COPY } from "@/lib/siteCopy";

export default function Loading() {
  return (
    <PageShell title={HOME_COPY.title} description={HOME_COPY.description}>
      <VideoListSkeleton />
    </PageShell>
  );
}
