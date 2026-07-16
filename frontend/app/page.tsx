import { VideoList } from "@/components/video-list";

export default function Home() {
  return (
    <div className="p-8 min-h-screen">
      <div className="max-w-[1400px] mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold mb-2">Video Streaming Demo</h1>
          <p className="text-muted-foreground">
            Explore different video streaming protocols and ABR algorithms
          </p>
        </header>

        <VideoList />
      </div>
    </div>
  );
}
