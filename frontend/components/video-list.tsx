"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listVideos, type VideoListItem } from "@/lib/videoApi";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    return <p className="text-destructive">Failed to load videos: {error}</p>;
  }

  if (videos === null) {
    return <p className="text-muted-foreground">Loading videos…</p>;
  }

  if (videos.length === 0) {
    return <p className="text-muted-foreground">No videos uploaded yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {videos.map((video) => (
        <Link key={video.videoId} href={`/${video.videoId}`}>
          <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardHeader>
              <CardTitle>{video.videoId}</CardTitle>
              <CardDescription>
                {formatSize(video.size)}
                {video.hasHls ? " · HLS" : ""}
                {video.hasDash ? " · DASH" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="aspect-video bg-muted rounded-md flex items-center justify-center">
                <span className="text-sm text-muted-foreground">{video.fileName}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
