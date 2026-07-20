"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/error-banner";
import { getPublicApiUrl } from "@/lib/env";
import { type UploadSessionResponse, updateUploadSessionVideo } from "@/lib/videoApi";

type UploadSessionPageProps = {
  initialSession: UploadSessionResponse;
};

export function UploadSessionPage({ initialSession }: UploadSessionPageProps) {
  const [session, setSession] = useState(initialSession);
  const [title, setTitle] = useState(initialSession.video.title ?? "");
  const [description, setDescription] = useState(initialSession.video.description ?? "");
  const [selectedFileName, setSelectedFileName] = useState(initialSession.video.originalFileName ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  async function handleSaveMetadata() {
    try {
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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <div className="space-y-6">
        {saveError && <ErrorBanner title="Failed to save upload details" message={saveError} />}

        <Card>
          <CardHeader>
            <CardTitle>Upload details</CardTitle>
            <CardDescription>
              This page is backed by a persisted upload session. Metadata saves now, while the file-transfer pipeline stays as boilerplate.
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
                id="video-file"
                type="file"
                accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
                onChange={(event) => setSelectedFileName(event.target.files?.[0]?.name ?? "")}
              />
              <p className="text-sm text-muted-foreground">
                {selectedFileName
                  ? `Selected file: ${selectedFileName}. File transfer is not wired yet.`
                  : "File transfer is not wired yet. This input is here to reserve the future upload workflow."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={handleSaveMetadata} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save details"}
              </Button>
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
            <CardDescription>Future pipeline workers can update this state without changing the page contract.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <Badge variant={statusTone}>{session.session.status}</Badge>
              <span className="text-sm text-muted-foreground">{session.session.progressPercent}% complete</span>
            </div>

            <Progress value={session.session.progressPercent} />

            <dl className="grid gap-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Future video route ID</dt>
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
            <CardDescription>Placeholder area for the future extracted thumbnail or uploaded poster image.</CardDescription>
          </CardHeader>
          <CardContent>
            {session.video.thumbnailUrl ? (
              <img
                src={session.video.thumbnailUrl}
                alt="Upload thumbnail preview"
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
