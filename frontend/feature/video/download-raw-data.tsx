"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { useActionAuth } from "@/components/action-auth-provider";
import { Button } from "@/components/ui/button";
import { currentDocument, getPublicApiUrl } from "@/lib/env";
import { videoTitle, type VideoListItem } from "@/lib/videoApi";

async function readJson(url: string): Promise<unknown> {
  const res = await fetch(url, currentDocument());
  if (!res.ok) {
    throw new Error(`${new URL(url).pathname} answered ${res.status}`);
  }
  return res.json();
}

function fileName(video: VideoListItem): string {
  const slug = videoTitle(video)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || video.routeId}-raw-data.json`;
}

/**
 * Saves everything the API holds for one video as a single JSON file: the catalogue entry,
 * packaging runs, the full analysis document (per-frame scores and encode grids included), every
 * saved benchmark run with its trace, and the aggregates.
 */
export function DownloadRawData({ video }: { video: VideoListItem }) {
  const { requireAuth } = useActionAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (!(await requireAuth())) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const base = `${getPublicApiUrl()}/api/videos/${video.routeId}`;
      const [transcodes, analysis, benchmarks, traces] = await Promise.all([
        readJson(`${base}/transcodes`),
        readJson(`${base}/analysis`),
        readJson(`${base}/benchmarks`),
        readJson(`${base}/benchmarks/traces`),
      ]);
      const bundle = {
        exportedAtUtc: new Date().toISOString(),
        video,
        transcodes,
        analysis,
        benchmarks,
        traces,
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName(video);
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <span className="text-sm text-destructive">{error}</span>}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void download()}>
        <Download />
        {busy ? "Preparing…" : "Download data"}
      </Button>
    </>
  );
}
