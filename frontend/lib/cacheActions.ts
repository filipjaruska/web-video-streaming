"use server";

import { updateTag } from "next/cache";

/**
 * Expires the cached catalogue, analyses and benchmarks, so the next render reads them fresh.
 * Called after a rename or delete, and by the Refresh buttons.
 */
export async function refreshData(): Promise<void> {
  updateTag("videos");
  updateTag("analysis");
  updateTag("benchmarks");
}
