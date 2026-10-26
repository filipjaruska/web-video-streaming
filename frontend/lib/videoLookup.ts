import { listVideos, type VideoListItem } from "@/lib/videoApi";

/**
 * One video from the catalogue: `null` when it does not exist, `undefined` when the catalogue could
 * not be reached (pages still render then). The list is cached, so the layout and the page asking
 * for the same video cost one request.
 */
export async function findVideo(routeId: string): Promise<VideoListItem | null | undefined> {
  try {
    const { videos } = await listVideos();
    return videos.find((video) => video.routeId === routeId) ?? null;
  } catch {
    return undefined;
  }
}

/** Whether the video's pages should keep refreshing because the pipeline is still running. */
export async function isProcessing(routeId: string): Promise<boolean> {
  return (await findVideo(routeId))?.status === "processing";
}
