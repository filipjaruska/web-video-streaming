import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";

import { isCacheTag } from "@/lib/cacheTags";

function authorized(request: Request): boolean {
  const expected = process.env.REVALIDATE_SECRET?.trim();
  // Unset, as in local development, any caller may expire the caches; nothing is read or written.
  if (!expected) {
    return true;
  }
  const provided = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  const wanted = Buffer.from(`Bearer ${expected}`, "utf8");
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

/**
 * Called by the backend after a database write, with the tags it made stale. They expire at once
 * (`expire: 0`), so the next request renders fresh data instead of being served the old copy.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ message: "Not authorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { tags?: unknown } | null;
  const tags = Array.isArray(body?.tags) ? body.tags.filter(isCacheTag) : [];
  for (const tag of new Set(tags)) {
    revalidateTag(tag, { expire: 0 });
  }
  return Response.json({ revalidated: tags });
}
