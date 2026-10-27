const DEFAULT_API_URL = "http://localhost:5000";
const DEFAULT_SITE_URL = "http://localhost:3000";

/** Also used (server-only): ACTION_PASSWORD — gates mutating UI actions via password popup. */

/** Server-side API base (private URL preferred). */
export function getApiUrl(): string {
  return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
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

/**
 * Fetch options for API documents that must always be current. In the browser the stored copy is
 * revalidated against the server's ETag, so an unchanged document costs a 304 and no body; on the
 * server (and in the tests) nothing is cached, which is what Node's fetch supports.
 */
export function currentDocument(): RequestInit {
  return typeof window === "undefined" ? { cache: "no-store" } : { cache: "no-cache" };
}
