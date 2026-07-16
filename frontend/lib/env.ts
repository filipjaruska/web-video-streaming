const DEFAULT_API_URL = "http://localhost:5000";
const DEFAULT_SITE_URL = "http://localhost:3000";

/** Server-side API base (private URL preferred). */
export function getApiUrl(): string {
  return (
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    DEFAULT_API_URL
  );
}

/** Browser-facing API base for streaming URLs. */
export function getPublicApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

/** Public site origin for sitemap / robots. */
export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : DEFAULT_SITE_URL)
  );
}
