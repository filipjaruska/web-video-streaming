"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useActionAuth } from "@/components/action-auth-provider";
import { ErrorBanner } from "@/components/error-banner";
import { getPublicApiUrl } from "@/lib/env";
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

const TERMINAL_STATUSES = new Set(["Completed", "Failed", "Expired"]);

export function UploadSessionPage({ initialSession }: UploadSessionPageProps) {
  const { requireAuth } = useActionAuth();
  const [session, setSession] = useState(initialSession);
  const [title, setTitle] = useState(initialSession.video.title ?? "");
  const [description, setDescription] = useState(initialSession.video.description ?? "");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const statusTone = useMemo(() => {
    switch (session.session.status) {
      case "Completed":
        return "default" as const;
      case "Failed":
      case "Expired":
        return "destructive" as const;
      default:
        return "secondary" as const;
    }
  }, [session.session.status]);

  const canUpload =
    !isUploading &&
    (session.session.status === "AwaitingUpload" || session.session.status === "Failed");

  useEffect(() => {
    setStoredUploadSessionId(session.sessionId);

    if (!isResumableUploadSession(session.session.status)) {
      clearStoredUploadSessionId();
    }
  }, [session.sessionId, session.session.status]);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(session.session.status)) {
      return;
    }

    if (
      session.session.status !== "Processing" &&
      session.session.status !== "Uploading" &&
      session.session.status !== "Uploaded"
    ) {
      return;
    }

    const apiUrl = getPublicApiUrl();
    const timer = window.setInterval(async () => {
      try {
        const next = await getUploadSession(apiUrl, session.sessionId);
        setSession(next);
      } catch {
        // Keep last known state if poll fails.
      }
    }, 2500);

    return () => window.clearInterval(timer);
  }, [session.session.status, session.sessionId]);

  async function handleSaveMetadata() {
    try {
      const allowed = await requireAuth();
      if (!allowed) {
        return;
      }

      setIsSaving(true);
      setSaveError(null);

      const nextSession = await updateUploadSessionVideo(getPublicApiUrl(), session.sessionId, {
        title,
        description,
      });

      setSession(nextSession);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save video details");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpload() {
    if (!selectedFile || !canUpload) {
      return;
    }

    try {
      const allowed = await requireAuth();
      if (!allowed) {
        return;
      }

      setIsUploading(true);
      setUploadError(null);

      const nextSession = await uploadSessionFile(
        getPublicApiUrl(),
        session.sessionId,
        selectedFile,
      );

      setSession(nextSession);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to upload video");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <div className="space-y-6">
        {saveError && <ErrorBanner title="Failed to save upload details" message={saveError} />}
        {uploadError && <ErrorBanner title="Upload failed" message={uploadError} />}

        <Card>
          <CardHeader>
            <CardTitle>Upload details</CardTitle>
            <CardDescription>
              Save metadata, then upload a source file. Transcoding starts automatically after upload.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Give this upload a title"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Add a short description for the future video page"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="video-file">Upload file</Label>
              <Input
                ref={fileInputRef}
                id="video-file"
                type="file"
                accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
                disabled={!canUpload}
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
              <p className="text-sm text-muted-foreground">
                {selectedFile
                  ? `Selected: ${selectedFile.name}`
                  : session.video.originalFileName
                    ? `Uploaded: ${session.video.originalFileName}`
                    : "Choose an MP4, MOV, AVI, MKV, or WebM file (max 500 MB)."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={handleSaveMetadata} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save details"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleUpload}
                disabled={!selectedFile || !canUpload}
              >
                {isUploading ? "Uploading..." : "Upload video"}
              </Button>
              {session.session.status === "Completed" && (
                <Button type="button" variant="outline" asChild>
                  <Link href={`/${session.video.routeId}`}>Open video</Link>
                </Button>
              )}
              <span className="text-sm text-muted-foreground">
                Session ID: <code>{session.sessionId}</code>
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Session status</CardTitle>
            <CardDescription>
              Upload and transcode progress for this session.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <Badge variant={statusTone}>{session.session.status}</Badge>
              <span className="text-sm text-muted-foreground">{session.session.progressPercent}% complete</span>
            </div>

            <Progress value={session.session.progressPercent} />

            <dl className="grid gap-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Video route ID</dt>
                <dd className="text-right font-mono text-xs">{session.video.routeId}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatDate(session.session.createdAtUtc)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Last updated</dt>
                <dd>{formatDate(session.session.updatedAtUtc)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Expires</dt>
                <dd>{formatDate(session.session.expiresAtUtc)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Thumbnail preview</CardTitle>
            <CardDescription>
              Generated after transcoding finishes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {session.video.thumbnailUrl ? (
              <img
                src={`${getPublicApiUrl()}${session.video.thumbnailUrl}`}
                alt="Upload thumbnail preview"
                loading="lazy"
                decoding="async"
                className="aspect-video w-full rounded-md border object-cover"
              />
            ) : (
              <div className="bg-muted text-muted-foreground flex aspect-video items-center justify-center rounded-md border text-sm">
                Thumbnail preview will appear here.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
