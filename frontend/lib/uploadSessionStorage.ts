import { formatDurationShort } from "@/lib/formatDuration";

const STORAGE_KEY = "active-upload-session-id";
export const UPLOAD_SESSION_STORAGE_EVENT = "upload-session-storage-changed";

const TERMINAL_STATUSES = new Set(["Completed", "Expired"]);

export function isResumableUploadSession(status: string): boolean {
  return !TERMINAL_STATUSES.has(status);
}

/** Idle label for the header Upload button based on session status / step. */
export function uploadSessionButtonLabel(
  status: string | null,
  currentStep?: string | null,
  estimatedRemainingSeconds?: number | null,
): string {
  switch (status) {
    case "AwaitingUpload":
    case "Failed":
      return "Resume";
    case "Uploading":
      return "Uploading";
    case "Uploaded":
    case "Processing": {
      const step = shortenProcessingStep(currentStep) ?? "Processing";
      if (
        typeof estimatedRemainingSeconds === "number" &&
        estimatedRemainingSeconds > 0
      ) {
        return `${step} · ${formatDurationShort(estimatedRemainingSeconds)}`;
      }
      return step;
    }
    default:
      return "Upload";
  }
}

function shortenProcessingStep(step: string | null | undefined): string | null {
  if (!step) {
    return null;
  }

  const normalized = step.toLowerCase();
  if (normalized.includes("encode grid")) {
    const match = step.match(/\((\d+)\s*\/\s*(\d+)\)/);
    return match ? `Grid ${match[1]}/${match[2]}` : "Encode grid";
  }
  if (normalized.includes("si/ti") || normalized.includes("siti")) {
    return "SI/TI";
  }
  if (normalized.includes("subtitle")) {
    return "Subtitles";
  }
  if (normalized.includes("media info") || normalized.includes("reading media")) {
    return "Media info";
  }
  if (normalized.includes("thumbnail")) {
    return "Thumbnail";
  }
  if (normalized.includes("vmaf")) {
    return "VMAF";
  }
  if (normalized.includes("deriving") || normalized.includes("crossover")) {
    return "Derive";
  }
  if (normalized.includes("hls")) {
    return "HLS";
  }
  if (normalized.includes("dash")) {
    return "DASH";
  }
  if (normalized.includes("queued") || normalized.includes("starting")) {
    return "Processing";
  }

  return step.length > 18 ? `${step.slice(0, 16)}…` : step;
}

function notifyStorageChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(UPLOAD_SESSION_STORAGE_EVENT));
}

export function getStoredUploadSessionId(): string | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }

  const value = sessionStorage.getItem(STORAGE_KEY)?.trim();
  return value ? value : null;
}

export function setStoredUploadSessionId(sessionId: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  sessionStorage.setItem(STORAGE_KEY, sessionId);
  notifyStorageChanged();
}

export function clearStoredUploadSessionId(): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  sessionStorage.removeItem(STORAGE_KEY);
  notifyStorageChanged();
}
