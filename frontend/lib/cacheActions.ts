"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

/**
 * Expires the cached catalogue, analyses and benchmarks, so the next render reads them fresh.
 * Called after a rename or delete, and by the Refresh buttons.
 */
export async function refreshData(): Promise<void> {
  updateTag("videos");
  updateTag("analysis");
  updateTag("benchmarks");
}

/**
 * The same, then a navigation to `path` rendered from the fresh data. For a delete: refreshing in
 * place would re-render the page of the video that no longer exists.
 */
export async function refreshDataAndOpen(path: string): Promise<void> {
  updateTag("videos");
  updateTag("analysis");
  updateTag("benchmarks");
  redirect(path);
}
