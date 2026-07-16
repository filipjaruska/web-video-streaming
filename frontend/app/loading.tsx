import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import { VideoListSkeleton } from "@/components/video-list-skeleton";

export default function Loading() {
  return (
    <PageShell
      title="Video Streaming Demo"
      description="Video Streaming Demo Description"
    >
      <Separator className="mb-6" />
      <VideoListSkeleton />
    </PageShell>
  );
}
