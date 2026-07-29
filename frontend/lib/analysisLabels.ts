import type { AnalysisTargetStatus } from "@/lib/videoAnalysisApi";

export function formatTargetStatus(status: AnalysisTargetStatus): string {
  switch (status) {
    case "not_implemented":
      return "Not implemented";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Pending";
  }
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return "—";
  }

  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toFixed(1).padStart(4, "0")}`;
}
