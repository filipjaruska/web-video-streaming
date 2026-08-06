/** Compact duration for ETA labels: ~45s, ~12m, ~1h 05m */
export function formatDurationShort(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) {
    return `~${seconds}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remSeconds = seconds % 60;

  if (hours <= 0) {
    return remSeconds >= 30 && minutes < 59
      ? `~${minutes + 1}m`
      : `~${Math.max(1, minutes)}m`;
  }

  return `~${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

/** Elapsed clock: m:ss or h:mm:ss */
export function formatElapsedClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rem = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${rem.toString().padStart(2, "0")}`;
}
