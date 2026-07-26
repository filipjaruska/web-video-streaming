import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/env";
import { listVideos } from "@/lib/videoApi";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl().replace(/\/$/, "");
  const entries: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];

  try {
    const { videos } = await listVideos();
    for (const video of videos) {
      entries.push({
        url: `${siteUrl}/${video.routeId}`,
        lastModified: video.createdAt ? new Date(video.createdAt) : new Date(),
        changeFrequency: "weekly",
        priority: 0.8,
      });
    }
  } catch {
    // Sitemap still returns the home entry if the catalog is unavailable.
  }

  return entries;
}
