"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import Link from "next/link";

import { useActionAuth } from "@/components/action-auth-provider";
import { ErrorBanner } from "@/components/error-banner";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { PipelineTimeline } from "@/feature/upload/pipeline-timeline";
import { PreliminaryResults } from "@/feature/upload/preliminary-results";
import { useEtaCountdown } from "@/hooks/useEtaCountdown";
import { getPublicApiUrl } from "@/lib/env";
import { formatDurationShort, formatElapsedClock } from "@/lib/formatDuration";
import {
  clearStoredUploadSessionId,
  isResumableUploadSession,
  setStoredUploadSessionId,
} from "@/lib/uploadSessionStorage";
import {
  type UploadSessionResponse,
  getUploadSession,
  updateUploadSessionVideo,
  uploadSessionFile,
} from "@/lib/videoApi";

type UploadSessionPageProps = {
  initialSession: UploadSessionResponse;
};

const POLLED_STATUSES = new Set(["Uploading", "Queued", "Processing"]);

const ACCEPTED = "video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm";

export function UploadSessionPage({ initialSession }: UploadSessionPageProps) {
  const { requireAuth } = useActionAuth();
  const [session, setSession] = useState(initialSession);
  const [title, setTitle] = useState(initialSession.video.title ?? "");
  const [description, setDescription] = useState(initialSession.video.description ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const state = session.session;
  const status = state.status;
  const isProcessing = status === "Processing";
  const awaitingFile = status === "AwaitingUpload" || (status === "Failed" && !state.uploadedAtUtc);

  const elapsedSeconds = useMemo(() => {
    if (!isProcessing || !state.processingStartedAtUtc) {
      return null;
    }
    const started = new Date(state.processingStartedAtUtc).getTime();
    return Number.isNaN(started) ? null : Math.max(0, Math.floor((nowMs - started) / 1000));
  }, [isProcessing, state.processingStartedAtUtc, nowMs]);

  const etaSeconds = useEtaCountdown(state.estimatedRemainingSeconds ?? null, isProcessing);

  useEffect(() => {
    if (!isProcessing) {
      return;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isProcessing]);

  useEffect(() => {
    setStoredUploadSessionId(session.sessionId);
    if (!isResumableUploadSession(status)) {
      clearStoredUploadSessionId();
    }
  }, [session.sessionId, status]);

  useEffect(() => {
    if (!POLLED_STATUSES.has(status)) {
      return;
    }
    const apiUrl = getPublicApiUrl();
    const timer = window.setInterval(async () => {
      try {
        setSession(await getUploadSession(apiUrl, session.sessionId));
      } catch {
        // Keep the last known state if a poll fails.
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [status, session.sessionId]);

  // Details are saved first, then the file goes up; one action instead of two buttons to order.
  async function handleUpload() {
    if (!file || busy || !(await requireAuth())) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const apiUrl = getPublicApiUrl();
      await updateUploadSessionVideo(apiUrl, session.sessionId, { title, description });
      setSession(await uploadSessionFile(apiUrl, session.sessionId, file));
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload failed.");
    } finally {
      setBusy(false);
    }
  }

  if (awaitingFile) {
    return (
      <form
        className="max-w-2xl space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handleUpload();
        }}
      >
        {error && <ErrorBanner title="Upload failed" message={error} />}
        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Defaults to the file name"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
          />
        </div>
        <label
          htmlFor="video-file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed px-6 py-10 text-center transition-colors hover:border-primary/60 hover:bg-accent/40"
        >
          <Upload className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium">{file ? file.name : "Choose a video file"}</span>
          <span className="text-xs text-muted-foreground">
            {file
              ? `${(file.size / 1_000_000).toFixed(1)} MB`
              : "MP4, MOV, AVI, MKV or WebM, up to 500 MB"}
          </span>
          <input
            ref={fileInputRef}
            id="video-file"
            type="file"
            accept={ACCEPTED}
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <Button type="submit" disabled={!file || busy}>
          {busy ? "Uploading…" : "Upload and process"}
        </Button>
      </form>
    );
  }

  const thumbnailUrl = session.video.thumbnailUrl
    ? `${getPublicApiUrl()}${session.video.thumbnailUrl}`
    : null;

  return (
    <div className="grid gap-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <StatusBadge status={status} />
            <span className="font-mono text-xs tabular text-muted-foreground">
              {state.progressPercent} %
            </span>
          </div>
          <Progress value={state.progressPercent} className="h-1.5" />
          <div className="flex justify-between gap-3 text-xs text-muted-foreground">
            {status === "Queued" && state.queuePosition != null && (
              <span>
                {state.queuePosition === 0
                  ? "Next in line"
                  : `${state.queuePosition} ahead in the queue`}
              </span>
            )}
            {elapsedSeconds != null && (
              <span>
                Elapsed{" "}
                <span className="font-mono tabular">{formatElapsedClock(elapsedSeconds)}</span>
              </span>
            )}
            {isProcessing && (
              <span>
                {etaSeconds == null
                  ? "Estimating time left"
                  : etaSeconds > 0
                    ? `${formatDurationShort(etaSeconds)} left`
                    : "Finishing this step"}
              </span>
            )}
          </div>
        </div>

        {status === "Failed" && (
          <ErrorBanner
            title="Processing failed"
            message={state.currentStep ?? "See the backend log."}
          />
        )}

        <PipelineTimeline session={state} />

        {status === "Completed" && (
          <Button asChild className="w-full">
            <Link href={`/${session.video.routeId}/results`}>Open the results</Link>
          </Button>
        )}
      </aside>

      <PreliminaryResults
        routeId={session.video.routeId}
        processing={status === "Queued" || isProcessing}
        thumbnailUrl={thumbnailUrl}
      />
    </div>
  );
}
