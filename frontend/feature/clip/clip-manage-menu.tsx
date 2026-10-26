"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { useActionAuth } from "@/components/action-auth-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { refreshData } from "@/lib/cacheActions";
import { getPublicApiUrl } from "@/lib/env";
import { deleteVideo, updateVideo, type VideoListItem } from "@/lib/videoApi";

type Open = "edit" | "delete" | null;

/** Rename, describe or delete a clip. Both go through the same password gate as every mutation. */
export function ClipManageMenu({ video }: { video: VideoListItem }) {
  const router = useRouter();
  const { requireAuth } = useActionAuth();
  const [open, setOpen] = useState<Open>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = video.title || video.fileName;

  function show(dialog: Open) {
    setTitle(video.title ?? "");
    setDescription(video.description ?? "");
    setError(null);
    setOpen(dialog);
  }

  async function run(action: () => Promise<void>) {
    if (!(await requireAuth())) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await action();
      await refreshData();
      setOpen(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      await updateVideo(getPublicApiUrl(), video.routeId, {
        title: title.trim() || null,
        description: description.trim() || null,
      });
      router.refresh();
    });

  const remove = () =>
    run(async () => {
      await deleteVideo(getPublicApiUrl(), video.routeId);
      router.push("/");
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <MoreHorizontal />
            Manage
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => show("edit")}>
            <Pencil />
            Edit title and description
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => show("delete")}>
            <Trash2 />
            Delete clip
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === "edit"} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit clip</DialogTitle>
            <DialogDescription className="font-mono text-xs">{video.fileName}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="clip-title">Title</Label>
              <Input
                id="clip-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                placeholder={video.fileName}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clip-description">Description</Label>
              <Textarea
                id="clip-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={4000}
                rows={4}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "delete"} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {label}?</DialogTitle>
            <DialogDescription>
              Removes the source, all three ladders, the analysis and the saved benchmark runs. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
