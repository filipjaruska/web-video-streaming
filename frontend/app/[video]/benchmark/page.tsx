import { VideoStreamingClient } from "@/components/video-streaming-client";

type BenchmarkPageProps = {
  params: Promise<{ video: string }>;
};

export default async function BenchmarkPage({ params }: BenchmarkPageProps) {
  const { video } = await params;
  return <VideoStreamingClient routeId={video} mode="benchmark" />;
}
