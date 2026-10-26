import { VideoStreamingClient } from "@/components/video-streaming-client";
import { isProcessing } from "@/lib/clipLookup";

type WatchPageProps = {
  params: Promise<{ video: string }>;
};

export default async function WatchPage({ params }: WatchPageProps) {
  const { video } = await params;
  return <VideoStreamingClient routeId={video} mode="watch" poll={await isProcessing(video)} />;
}
