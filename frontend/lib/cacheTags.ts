/**
 * The tags server-cached data is filed under. The backend names the same three
 * (`FrontendCacheTags` in `backend/Core/FrontendCache.cs`) when it reports a write.
 */
export const CACHE_TAGS = ["videos", "analysis", "benchmarks"] as const;

export type CacheTag = (typeof CACHE_TAGS)[number];

export function isCacheTag(value: unknown): value is CacheTag {
  return CACHE_TAGS.includes(value as CacheTag);
}
