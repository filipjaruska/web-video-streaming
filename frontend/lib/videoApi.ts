export interface UploadVideoResponse {
  message: string;
  videoId: string;
  hlsPath: string;
  dashPath: string;
  httpRangePath: string;
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
