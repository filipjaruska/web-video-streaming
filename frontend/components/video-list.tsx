import Link from "next/link";
import { Play } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getPublicApiUrl } from "@/lib/env";
import type { VideoListItem } from "@/lib/videoApi";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface VideoListProps {
  videos: VideoListItem[];
}

export function VideoList({ videos }: VideoListProps) {
  if (videos.length === 0) {
    return <p className="text-muted-foreground">No videos uploaded yet.</p>;
  }

  const apiUrl = getPublicApiUrl();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 @min-[1400px]/page:grid-cols-4 gap-6">
      {videos.map((video) => (
        <Link key={video.routeId} href={`/${video.routeId}`} className="group">
          <Card className="h-full gap-0 py-0 overflow-hidden transition-all hover:border-primary/40 hover:shadow-md">
            <div className="relative aspect-video bg-muted overflow-hidden">
              {video.thumbnailUrl ? (
                <img
                  src={`${apiUrl}${video.thumbnailUrl}`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 size-full object-cover"
                />
              ) : null}
              <div className="absolute inset-0 flex items-center justify-center">
                <span
                  className={
                    video.thumbnailUrl
                      ? "flex size-12 items-center justify-center rounded-full bg-black/45 text-white shadow-sm transition-colors group-hover:bg-black/60"
                      : undefined
                  }
                >
                  <Play
                    className={
                      video.thumbnailUrl
                        ? "size-6 fill-current"
                        : "size-10 text-muted-foreground/50 transition-colors group-hover:text-primary/70"
                    }
                  />
                </span>
              </div>
            </div>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base truncate">
                {video.title || video.fileName}
              </CardTitle>
              <CardDescription className="flex items-center gap-2 flex-wrap">
                <span>{formatSize(video.size)}</span>
                {video.hasHls && <Badge variant="secondary">HLS</Badge>}
                {video.hasDash && <Badge variant="secondary">DASH</Badge>}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <p className="text-xs text-muted-foreground truncate font-mono">
                {video.routeId}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
