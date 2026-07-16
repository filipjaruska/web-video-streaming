"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { Play } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/error-banner";
import { listVideos, type VideoListItem } from "@/lib/videoApi";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VideoListSkeleton() {
  return (
    <SkeletonTheme baseColor="var(--muted)" highlightColor="var(--accent)">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 @min-[1400px]/page:grid-cols-4 gap-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="overflow-hidden gap-0 py-0">
            <div className="aspect-video w-full">
              <Skeleton
                className="!h-full !rounded-none"
                containerClassName="block h-full leading-none"
              />
            </div>
            <div className="p-4 space-y-2">
              <Skeleton width="70%" height={18} />
              <Skeleton width="40%" height={14} />
            </div>
          </Card>
        ))}
      </div>
    </SkeletonTheme>
  );
}

export function VideoList() {
  const [videos, setVideos] = useState<VideoListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listVideos(API_URL)
      .then((data) => setVideos(data.videos))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return <ErrorBanner title="Failed to load videos" message={error} />;
  }

  if (videos === null) {
    return <VideoListSkeleton />;
  }

  if (videos.length === 0) {
    return <p className="text-muted-foreground">No videos uploaded yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 @min-[1400px]/page:grid-cols-4 gap-6">
      {videos.map((video) => (
        <Link key={video.videoId} href={`/${video.videoId}`} className="group">
          <Card className="h-full gap-0 py-0 overflow-hidden transition-all hover:border-primary/40 hover:shadow-md">
            <div className="aspect-video bg-muted flex items-center justify-center">
              <Play className="size-10 text-muted-foreground/50 transition-colors group-hover:text-primary/70" />
            </div>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base truncate">{video.fileName}</CardTitle>
              <CardDescription className="flex items-center gap-2 flex-wrap">
                <span>{formatSize(video.size)}</span>
                {video.hasHls && <Badge variant="secondary">HLS</Badge>}
                {video.hasDash && <Badge variant="secondary">DASH</Badge>}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <p className="text-xs text-muted-foreground truncate font-mono">{video.videoId}</p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
