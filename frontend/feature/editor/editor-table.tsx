"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useActionAuth } from "@/components/action-auth-provider";
import { deleteVideo, updateVideo, type VideoListItem } from "@/lib/videoApi";
import { getPublicApiUrl } from "@/lib/env";

/**
 * Catalogue management: rename, describe, or remove a clip.
 *
 * Mutations go through the same password gate as every other destructive action in the app, so
 * this page adds a surface rather than a second security model.
 */
export function EditorTable({ videos }: { videos: VideoListItem[] }) {
  const router = useRouter();
  const { requireAuth } = useActionAuth();
  const apiUrl = getPublicApiUrl();

  const [editing, setEditing] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function beginEdit(video: VideoListItem) {
    setEditing(video.routeId);
    setTitle(video.title ?? "");
    setDescription("");
    setNotice(null);
    setError(null);
  }

  async function save(routeId: string) {
    if (!(await requireAuth())) return;

    setBusy(true);
    setError(null);
    try {
      await updateVideo(apiUrl, routeId, {
        title: title.trim() || null,
        description: description.trim() || null,
      });
      setEditing(null);
      setNotice("Saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(video: VideoListItem) {
    if (!(await requireAuth())) return;

    const label = video.title || video.fileName;
    if (
      !window.confirm(
        `Delete "${label}" and every ladder generated from it? This cannot be undone.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await deleteVideo(apiUrl, video.routeId);
      setNotice(`Deleted "${label}".`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  if (videos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No clips yet. Use the upload button in the header to add one.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {videos.map((video) => (
        <Card key={video.routeId}>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle className="text-base">
                  {video.title || video.fileName}
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  {video.routeId}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {video.hasHls && <Badge variant="secondary">HLS</Badge>}
                {video.hasDash && <Badge variant="secondary">DASH</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {editing === video.routeId ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`title-${video.routeId}`}>Title</Label>
                  <Input
                    id={`title-${video.routeId}`}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={200}
                    placeholder={video.fileName}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`description-${video.routeId}`}>
                    Description
                  </Label>
                  <Textarea
                    id={`description-${video.routeId}`}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={4000}
                    rows={3}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void save(video.routeId)}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => beginEdit(video)}>
                  Edit metadata
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/${video.routeId}`}>Open player</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/${video.routeId}/analysis`}>Analysis</Link>
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void remove(video)}
                >
                  Delete
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
