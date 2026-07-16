import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadVideo } from "@/lib/videoApi";

const API_URL = "http://localhost:5180";

const mockResponse = {
  message: "Video uploaded successfully",
  videoId: "sample_video",
  hlsPath: "/hls/sample_video/master.m3u8",
  dashPath: "/dash/sample_video/manifest.mpd",
  httpRangePath: "/httprange/sample_video/sample_video.mp4",
};

describe("uploadVideo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /api/videoUpload and returns the video paths from the backend", async () => {
    const file = new File(["video content"], "sample_video.mp4", {
      type: "video/mp4",
    });

    const result = await uploadVideo(API_URL, file, "sample_video");

    // Verify fetch was called with the correct backend URL and method
    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/api/videoUpload`,
      expect.objectContaining({ method: "POST" }),
    );

    // Verify the response is correctly passed through
    expect(result.videoId).toBe("sample_video");
    expect(result.hlsPath).toBe("/hls/sample_video/master.m3u8");
    expect(result.dashPath).toBe("/dash/sample_video/manifest.mpd");
    expect(result.httpRangePath).toBe(
      "/httprange/sample_video/sample_video.mp4",
    );
  });
});
