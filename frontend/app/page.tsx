import { VideoList } from "@/components/video-list";
import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  return (
    <PageShell
      title="Video Streaming Demo"
      description="Explore different video streaming protocols and ABR algorithms"
    >
      <Separator className="mb-6" />
      <VideoList />
    </PageShell>
  );
}
