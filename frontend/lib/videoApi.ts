import { cache } from "react";
import { getApiUrl } from "@/lib/env";

export interface UploadVideoResponse {
  message: string;
  videoId: string;
  hlsPath: string;
  dashPath: string;
  httpRangePath: string;
}

export interface UploadSessionVideo {
  routeId: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  originalFileName: string | null;
  storageKey: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  publishedAtUtc: string | null;
}

export interface UploadSessionState {
  status: string;
  progressPercent: number;
  createdAtUtc: string;
  updatedAtUtc: string;
  expiresAtUtc: string;
  uploadedAtUtc: string | null;
  completedAtUtc: string | null;
}

export interface UploadSessionResponse {
  sessionId: string;
  redirectUrl: string;
  session: UploadSessionState;
  video: UploadSessionVideo;
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

export interface UpdateUploadSessionVideoRequest {
  title: string;
  description: string;
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

export async function createUploadSession(
  apiUrl: string,
): Promise<UploadSessionResponse> {
  const res = await fetch(`${apiUrl}/api/uploadSessions`, {
    method: "POST",
  });

  if (!res.ok) {
    throw new Error(`Failed to create upload session: ${res.status}`);
  }

  return res.json() as Promise<UploadSessionResponse>;
}

export async function getUploadSession(
  apiUrl: string,
  sessionId: string,
): Promise<UploadSessionResponse> {
  const res = await fetch(`${apiUrl}/api/uploadSessions/${sessionId}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to load upload session: ${res.status}`);
  }

  return res.json() as Promise<UploadSessionResponse>;
}

export async function updateUploadSessionVideo(
  apiUrl: string,
  sessionId: string,
  payload: UpdateUploadSessionVideoRequest,
): Promise<UploadSessionResponse> {
  const res = await fetch(`${apiUrl}/api/uploadSessions/${sessionId}/video`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Failed to update upload session video: ${res.status}`);
  }

  return res.json() as Promise<UploadSessionResponse>;
}

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
