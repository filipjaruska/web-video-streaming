import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import { VideoPlayerSkeleton } from "@/components/video-player-skeleton";

export default function Loading() {
  return (
    <PageShell
      title="Loading…"
      description="Compare HTTP Range, HLS, and DASH streaming protocols with different ABR algorithms"
      actionLabel="Display Analysis"
    >
      <Separator className="mb-6" />
      <VideoPlayerSkeleton />
    </PageShell>
  );
}
