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

export async function listVideos(apiUrl: string): Promise<ListVideosResponse> {
  const res = await fetch(`${apiUrl}/api/videoUpload/list`);

  if (!res.ok) {
    throw new Error(`Failed to list videos: ${res.status}`);
  }

  return res.json() as Promise<ListVideosResponse>;
}
