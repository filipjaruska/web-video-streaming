import type { MetadataRoute } from "next";

/** Empty on purpose should not be discoverable via search engines. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}
