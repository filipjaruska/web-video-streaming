import { cache } from "react";
import { getApiUrl } from "@/lib/env";

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
  currentStep?: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  expiresAtUtc: string;
  uploadedAtUtc: string | null;
  completedAtUtc: string | null;
  processingStartedAtUtc?: string | null;
  estimatedRemainingSeconds?: number | null;
}

export interface UploadSessionResponse {
  sessionId: string;
  redirectUrl: string;
  session: UploadSessionState;
  video: UploadSessionVideo;
}

export interface VideoListItem {
  routeId: string;
  title: string | null;
  fileName: string;
  thumbnailUrl: string | null;
  size: number;
  createdAt: string;
  publishedAt: string | null;
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
    throw new Error(`Failed to update upload session: ${res.status}`);
  }

  return res.json() as Promise<UploadSessionResponse>;
}

export async function uploadSessionFile(
  apiUrl: string,
  sessionId: string,
  file: File,
): Promise<UploadSessionResponse> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${apiUrl}/api/uploadSessions/${sessionId}/upload`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : `Upload failed: ${res.status}`;
    throw new Error(message);
  }

  return res.json() as Promise<UploadSessionResponse>;
}

export const listVideos = cache(async (): Promise<ListVideosResponse> => {
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/api/videos`, {
    next: { revalidate: 60, tags: ["videos"] },
  });

  if (!res.ok) {
    throw new Error(`Failed to list videos: ${res.status}`);
  }

  return res.json() as Promise<ListVideosResponse>;
});
