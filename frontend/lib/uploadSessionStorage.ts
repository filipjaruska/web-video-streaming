const STORAGE_KEY = "active-upload-session-id";
export const UPLOAD_SESSION_STORAGE_EVENT = "upload-session-storage-changed";

const TERMINAL_STATUSES = new Set(["Completed", "Expired"]);

export function isResumableUploadSession(status: string): boolean {
  return !TERMINAL_STATUSES.has(status);
}

/** Idle label for the header Upload button based on session status. */
export function uploadSessionButtonLabel(status: string | null): string {
  switch (status) {
    case "AwaitingUpload":
    case "Failed":
      return "Resume";
    case "Uploading":
      return "Uploading";
    case "Uploaded":
    case "Processing":
      return "Processing";
    default:
      return "Upload";
  }
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
