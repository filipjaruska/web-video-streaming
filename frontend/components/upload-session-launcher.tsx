"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useActionAuth } from "@/components/action-auth-provider";
import { Button } from "@/components/ui/button";
import { getPublicApiUrl } from "@/lib/env";
import {
  clearStoredUploadSessionId,
  getStoredUploadSessionId,
  isResumableUploadSession,
  setStoredUploadSessionId,
  UPLOAD_SESSION_STORAGE_EVENT,
  uploadSessionButtonLabel,
} from "@/lib/uploadSessionStorage";
import { createUploadSession, getUploadSession } from "@/lib/videoApi";

export function UploadSessionLauncher() {
  const router = useRouter();
  const { requireAuth } = useActionAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);

  const refreshStoredSession = useCallback(async () => {
    const storedSessionId = getStoredUploadSessionId();
    if (!storedSessionId) {
      setSessionStatus(null);
      return;
    }

    try {
      const existing = await getUploadSession(getPublicApiUrl(), storedSessionId);
      if (!isResumableUploadSession(existing.session.status)) {
        clearStoredUploadSessionId();
        setSessionStatus(null);
        return;
      }

      setSessionStatus(existing.session.status);
    } catch {
      clearStoredUploadSessionId();
      setSessionStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshStoredSession();

    function onVisible() {
      if (document.visibilityState === "visible") {
        void refreshStoredSession();
      }
    }

    function onStorageChanged() {
      void refreshStoredSession();
    }

    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(UPLOAD_SESSION_STORAGE_EVENT, onStorageChanged);

    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(UPLOAD_SESSION_STORAGE_EVENT, onStorageChanged);
    };
  }, [refreshStoredSession]);

  useEffect(() => {
    if (!sessionStatus || !isResumableUploadSession(sessionStatus)) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshStoredSession();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [sessionStatus, refreshStoredSession]);

  async function handleCreateSession() {
    try {
      const allowed = await requireAuth();
      if (!allowed) {
        return;
      }

      setIsLoading(true);
      const apiUrl = getPublicApiUrl();

      const storedSessionId = getStoredUploadSessionId();
      if (storedSessionId) {
        try {
          const existing = await getUploadSession(apiUrl, storedSessionId);
          if (isResumableUploadSession(existing.session.status)) {
            setSessionStatus(existing.session.status);
            router.push(existing.redirectUrl);
            return;
          }

          clearStoredUploadSessionId();
          setSessionStatus(null);
        } catch {
          clearStoredUploadSessionId();
          setSessionStatus(null);
        }
      }

      const session = await createUploadSession(apiUrl);
      setStoredUploadSessionId(session.sessionId);
      setSessionStatus(session.session.status);
      router.push(session.redirectUrl);
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  }

  const idleLabel = uploadSessionButtonLabel(sessionStatus);

  return (
    <Button type="button" onClick={handleCreateSession} disabled={isLoading}>
      {isLoading ? "Loading..." : idleLabel}
    </Button>
  );
}
