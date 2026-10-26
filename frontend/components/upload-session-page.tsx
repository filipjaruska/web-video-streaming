"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Upload } from "lucide-react";
import Link from "next/link";

import { useActionAuth } from "@/components/action-auth-provider";
import { ErrorBanner } from "@/components/error-banner";
import { PageShell } from "@/components/page-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { PipelineTimeline } from "@/feature/upload/pipeline-timeline";
import { PreliminaryResults } from "@/feature/upload/preliminary-results";
import { useEtaCountdown } from "@/hooks/useEtaCountdown";
import { refreshData } from "@/lib/cacheActions";
import { getPublicApiUrl } from "@/lib/env";
import { formatDurationShort, formatElapsedClock } from "@/lib/formatDuration";
import { cn } from "@/lib/utils";
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

/** How long the "Saved" confirmation stays next to the button. */
const SAVED_NOTICE_MS = 2500;

/**
 * The upload page: the video's details, editable at every stage, then either the file picker or
 * the processing timeline next to the results produced so far. The page header shows the name and
 * description as they are typed.
 */
export function UploadSessionPage({ initialSession }: UploadSessionPageProps) {
  const { requireAuth } = useActionAuth();
  const [session, setSession] = useState(initialSession);
  const [title, setTitle] = useState(initialSession.video.title ?? "");
  const [description, setDescription] = useState(initialSession.video.description ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Null until mounted: a clock read during server rendering never matches the client's.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const state = session.session;
  const status = state.status;
  const isProcessing = status === "Processing";
  const awaitingFile = status === "AwaitingUpload" || (status === "Failed" && !state.uploadedAtUtc);
  const dirty =
    title.trim() !== (session.video.title ?? "") ||
    description.trim() !== (session.video.description ?? "");

  const elapsedSeconds = useMemo(() => {
    if (!isProcessing || !state.processingStartedAtUtc || nowMs === null) {
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
    setNowMs(Date.now());
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

  // The results and the catalogue are cached on the server; a pipeline that finishes while this
  // page watches expires them, so "Open the results" shows the finished video.
  const previousStatus = useRef(status);
  useEffect(() => {
    if (status === "Completed" && previousStatus.current !== "Completed") {
      void refreshData();
    }
    previousStatus.current = status;
  }, [status]);

  useEffect(() => {
    if (savedAt === null) {
      return;
    }
    const timer = window.setTimeout(() => setSavedAt(null), SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [savedAt]);

  async function saveDetails() {
    const next = await updateUploadSessionVideo(getPublicApiUrl(), session.sessionId, {
      title: title.trim(),
      description: description.trim(),
    });
    setSession(next);
    // The catalogue and the results are cached; a new name should show everywhere at once.
    await refreshData();
  }

  async function handleSave() {
    if (!dirty || !title.trim() || saving || !(await requireAuth())) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveDetails();
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The details could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  // Details are saved first, then the file goes up; one action instead of two buttons to order.
  async function handleUpload() {
    if (!file || !title.trim() || uploading || !(await requireAuth())) {
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await saveDetails();
      setSession(await uploadSessionFile(getPublicApiUrl(), session.sessionId, file));
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const details = (
    <section className="rounded-md border p-4 sm:p-5">
      <form
        className={cn(
          "grid gap-4 lg:items-end",
          awaitingFile
            ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
            : "lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          void (awaitingFile ? handleUpload() : handleSave());
        }}
      >
        <div className="space-y-1.5 lg:self-start">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder="Name shown for this video"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={4000}
            rows={2}
            className="min-h-9"
            placeholder="Optional"
          />
        </div>
        {!awaitingFile && (
          <div className="flex items-center gap-3">
            {savedAt !== null && !dirty && (
              <span className="inline-flex items-center gap-1 text-sm text-success animate-rise">
                <Check className="size-4" />
                Saved
              </span>
            )}
            <Button type="submit" variant="outline" disabled={!dirty || !title.trim() || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </form>
    </section>
  );

  const thumbnailUrl = session.video.thumbnailUrl
    ? `${getPublicApiUrl()}${session.video.thumbnailUrl}`
    : null;

  return (
    <PageShell
      eyebrow="Upload"
      title={title.trim() || "New video"}
      description={description.trim() || undefined}
      actions={
        !awaitingFile && (
          <span className="flex items-center gap-3">
            <StatusBadge status={status} />
            {status === "Completed" && (
              <Button asChild size="sm">
                <Link href={`/${session.video.routeId}/results`}>Open the results</Link>
              </Button>
            )}
          </span>
        )
      }
    >
      <div className="space-y-8">
        {error && <ErrorBanner title="Something went wrong" message={error} />}
        {details}

        {awaitingFile ? (
          <div className="space-y-4">
            <label
              htmlFor="video-file"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed px-6 py-14 text-center transition-colors hover:border-primary hover:bg-accent/40"
            >
              <Upload className="size-6 text-muted-foreground" />
              <span className="font-medium">{file ? file.name : "Choose a video file"}</span>
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {title.trim()
                  ? "The page can be left and reopened once the upload is done; processing carries on."
                  : "Give the video a title to upload it."}
              </p>
              <Button
                disabled={!file || !title.trim() || uploading}
                onClick={() => void handleUpload()}
              >
                {uploading ? "Uploading…" : "Upload and process"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                  <span>Processing</span>
                  <span className="font-mono tabular">{state.progressPercent} %</span>
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
                      <span className="font-mono tabular">
                        {formatElapsedClock(elapsedSeconds)}
                      </span>
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
            </aside>

            <PreliminaryResults
              routeId={session.video.routeId}
              processing={status === "Queued" || isProcessing}
              thumbnailUrl={thumbnailUrl}
            />
          </div>
        )}
      </div>
    </PageShell>
  );
}
