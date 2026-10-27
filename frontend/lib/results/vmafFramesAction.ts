"use server";

import { loadVmafFrames, type VmafFrames } from "@/lib/serverCache";

/** The per-frame VMAF of one packaged rung, for the chart on the Results tab. */
export async function getVmafFrames(
  routeId: string,
  targetId: string,
  format: string,
  label: string,
): Promise<VmafFrames | null> {
  return loadVmafFrames(routeId, targetId, format, label);
}
