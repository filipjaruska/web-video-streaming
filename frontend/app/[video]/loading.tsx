import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import { VideoPlayerSkeleton } from "@/components/video-player-skeleton";

export default function Loading() {
  return (
    <PageShell title="Loading…" actionLabel="Analysis">
      <Separator className="mb-6" />
      <VideoPlayerSkeleton />
    </PageShell>
  );
}
