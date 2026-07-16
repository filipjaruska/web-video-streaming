import { cache } from "react";
import { getApiUrl } from "@/lib/env";

export interface UploadVideoResponse {
  message: string;
  videoId: string;
  hlsPath: string;
  dashPath: string;
  httpRangePath: string;
}

export interface VideoListItem {
  videoId: string;
  fileName: string;
  size: number;
  createdAt: string;
  hasHls: boolean;
  hasDash: boolean;
}

export interface ListVideosResponse {
  count: number;
  videos: VideoListItem[];
}

export async function uploadVideo(
  apiUrl: string,
  file: File,
  videoId?: string,
): Promise<UploadVideoResponse> {
  const form = new FormData();
  form.append("file", file);
  if (videoId) form.append("videoId", videoId);

  const res = await fetch(`${apiUrl}/api/videoUpload`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }

  return res.json() as Promise<UploadVideoResponse>;
}

/** Cached video catalog — shared across page, sitemap, and metadata in one request. */
export const listVideos = cache(async (): Promise<ListVideosResponse> => {
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/api/videoUpload/list`, {
    next: { revalidate: 60, tags: ["videos"] },
  });

  if (!res.ok) {
    throw new Error(`Failed to list videos: ${res.status}`);
  }

  return res.json() as Promise<ListVideosResponse>;
});
