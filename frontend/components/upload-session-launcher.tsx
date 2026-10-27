"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
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
import { useEtaCountdown } from "@/hooks/useEtaCountdown";

export function UploadSessionLauncher() {
  const router = useRouter();
  const { requireAuth } = useActionAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isNavigating, startNavigation] = useTransition();
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [estimatedRemainingSeconds, setEstimatedRemainingSeconds] = useState<number | null>(null);

  const clearActiveSession = useCallback(() => {
    clearStoredUploadSessionId();
    setSessionStatus(null);
    setCurrentStep(null);
    setEstimatedRemainingSeconds(null);
  }, []);

  const refreshStoredSession = useCallback(async () => {
    const storedSessionId = getStoredUploadSessionId();
    if (!storedSessionId) {
      setSessionStatus(null);
      setCurrentStep(null);
      setEstimatedRemainingSeconds(null);
      return;
    }

    try {
      const existing = await getUploadSession(getPublicApiUrl(), storedSessionId);
      if (!isResumableUploadSession(existing.session.status)) {
        clearActiveSession();
        return;
      }

      setSessionStatus(existing.session.status);
      setCurrentStep(existing.session.currentStep ?? null);
      setEstimatedRemainingSeconds(existing.session.estimatedRemainingSeconds ?? null);
    } catch {
      clearActiveSession();
    }
  }, [clearActiveSession]);

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

    // Poll faster while processing so step labels stay fresh.
    const intervalMs = sessionStatus === "Processing" ? 2000 : 5000;
    const timer = window.setInterval(() => {
      void refreshStoredSession();
    }, intervalMs);

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
      // The header outlives the navigation, so the label follows the transition: it shows
      // "Opening…" until the upload page has rendered, then clears.
      const open = (url: string) => startNavigation(() => router.push(url));

      const storedSessionId = getStoredUploadSessionId();
      if (storedSessionId) {
        try {
          const existing = await getUploadSession(apiUrl, storedSessionId);
          if (isResumableUploadSession(existing.session.status)) {
            setSessionStatus(existing.session.status);
            setCurrentStep(existing.session.currentStep ?? null);
            setEstimatedRemainingSeconds(existing.session.estimatedRemainingSeconds ?? null);
            open(existing.redirectUrl);
            return;
          }

          clearActiveSession();
        } catch {
          clearActiveSession();
        }
      }

      const session = await createUploadSession(apiUrl);
      setStoredUploadSessionId(session.sessionId);
      setSessionStatus(session.session.status);
      setCurrentStep(session.session.currentStep ?? null);
      setEstimatedRemainingSeconds(session.session.estimatedRemainingSeconds ?? null);
      open(session.redirectUrl);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }

  const remainingSeconds = useEtaCountdown(
    estimatedRemainingSeconds,
    sessionStatus === "Processing",
  );

  const idleLabel = uploadSessionButtonLabel(sessionStatus, currentStep, remainingSeconds);

  return (
    <Button type="button" onClick={handleCreateSession} disabled={isLoading || isNavigating}>
      {isLoading || isNavigating ? "Opening…" : idleLabel}
    </Button>
  );
}
