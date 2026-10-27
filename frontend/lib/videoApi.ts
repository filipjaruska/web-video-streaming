import { actionFetch } from "@/lib/actionPassword";
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
  /** The pipeline step behind `currentStep` (a backend `PipelineStep` name), null outside processing. */
  currentStepKey?: string | null;
  /** Progress inside the current step, e.g. grid samples 12 of 51. */
  currentStepDone?: number | null;
  currentStepTotal?: number | null;
  /** While `Queued`: how many videos the worker takes before this one. */
  queuePosition?: number | null;
}

export interface UploadSessionResponse {
  sessionId: string;
  redirectUrl: string;
  session: UploadSessionState;
  video: UploadSessionVideo;
}

export type VideoProcessingStatus = "processing" | "ready" | "failed";

export interface VideoListItem {
  routeId: string;
  title: string | null;
  description: string | null;
  status: VideoProcessingStatus;
  fileName: string;
  thumbnailUrl: string | null;
  size: number;
  createdAt: string;
  publishedAt: string | null;
  hasHls: boolean;
  hasDash: boolean;
}

/** The name a video is shown under: the title entered for it, never the uploaded file's name. */
export function videoTitle(video: { title: string | null }): string {
  return video.title?.trim() || "Untitled video";
}

export interface ListVideosResponse {
  count: number;
  videos: VideoListItem[];
}

export interface UpdateUploadSessionVideoRequest {
  title: string;
  description: string;
}

function failure(action: string, status: number): string {
  return status === 401
    ? `${action}: the password was not accepted. Try again to enter it.`
    : `${action}: ${status}`;
}
export async function createUploadSession(apiUrl: string): Promise<UploadSessionResponse> {
  const res = await actionFetch(`${apiUrl}/api/uploadSessions`, {
    method: "POST",
  });

  if (!res.ok) {
    throw new Error(failure("Failed to create upload session", res.status));
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
  const res = await actionFetch(`${apiUrl}/api/uploadSessions/${sessionId}/video`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(failure("Failed to update upload session", res.status));
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

  const res = await actionFetch(`${apiUrl}/api/uploadSessions/${sessionId}/upload`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : failure("Upload failed", res.status);
    throw new Error(message);
  }

  return res.json() as Promise<UploadSessionResponse>;
}

export interface UpdateVideoResponse {
  routeId: string;
  title?: string | null;
  description?: string | null;
}

/** Edits a published video's metadata. The upload-session route cannot reach it once published. */
export async function updateVideo(
  apiUrl: string,
  routeId: string,
  payload: { title?: string | null; description?: string | null },
): Promise<UpdateVideoResponse> {
  const res = await actionFetch(`${apiUrl}/api/videos/${routeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(failure("Failed to update video", res.status));
  }

  return res.json() as Promise<UpdateVideoResponse>;
}

export async function deleteVideo(apiUrl: string, routeId: string): Promise<void> {
  const res = await actionFetch(`${apiUrl}/api/videos/${routeId}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    throw new Error(failure("Failed to delete video", res.status));
  }
}

/** Uncached; pages read the catalogue through `loadCatalogue` in `lib/serverCache.ts`. */
export async function listVideos(): Promise<ListVideosResponse> {
  const res = await fetch(`${getApiUrl()}/api/videos`, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`Failed to list videos: ${res.status}`);
  }

  return res.json() as Promise<ListVideosResponse>;
}
