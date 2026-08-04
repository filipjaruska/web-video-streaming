export interface SubtitleTrack {
  id: string;
  language: string;
  label: string;
  url: string;
  /** Image-based or failed extractions are omitted from tracks; listed here for UI/debug. */
  skipped?: boolean;
  skipReason?: string | null;
}

export interface VideoSubtitlesResponse {
  routeId: string;
  tracks: SubtitleTrack[];
  skipped: Array<{
    id: string;
    language: string;
    label: string;
    reason: string;
  }>;
}

export async function getVideoSubtitles(
  apiUrl: string,
  routeId: string,
): Promise<VideoSubtitlesResponse> {
  const res = await fetch(`${apiUrl}/api/videos/${routeId}/subs`, {
    cache: "no-store",
  });

  if (!res.ok) {
    if (res.status === 404) {
      return { routeId, tracks: [], skipped: [] };
    }
    throw new Error(`Failed to load subtitles: ${res.status}`);
  }

  const data = (await res.json()) as VideoSubtitlesResponse;
  return {
    ...data,
    tracks: (data.tracks ?? []).map((track) => ({
      ...track,
      url: track.url.startsWith("http")
        ? track.url
        : `${apiUrl}${track.url.startsWith("/") ? "" : "/"}${track.url}`,
    })),
  };
}
