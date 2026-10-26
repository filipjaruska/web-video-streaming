"use client";

import { useState, useTransition } from "react";
import { Database, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { useActionAuth } from "@/components/action-auth-provider";
import { Button } from "@/components/ui/button";
import { actionFetch } from "@/lib/actionPassword";
import { refreshData } from "@/lib/cacheActions";
import { getPublicApiUrl } from "@/lib/env";

/** The file name the backend gives the export, or a dated fallback. */
function exportName(res: Response): string {
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match ? decodeURIComponent(match[1]) : `app-${new Date().toISOString().slice(0, 10)}.db`;
}

export function ResultsToolbar() {
  const router = useRouter();
  const { requireAuth } = useActionAuth();
  const [refreshing, startRefresh] = useTransition();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The whole database leaves the server, so the backend asks for the password like it does for
  // changes; a plain link cannot carry the header, so the file is fetched and then saved.
  async function downloadDatabase() {
    if (!(await requireAuth())) {
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const res = await actionFetch(`${getPublicApiUrl()}/api/database/export`);
      if (!res.ok) {
        throw new Error(
          res.status === 401 ? "The password was not accepted." : `Export failed: ${res.status}`,
        );
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = exportName(res);
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      {error && <span className="text-sm text-destructive">{error}</span>}
      <Button
        variant="outline"
        size="sm"
        disabled={refreshing}
        onClick={async () => {
          if (!(await requireAuth())) {
            return;
          }
          startRefresh(async () => {
            await refreshData();
            router.refresh();
          });
        }}
      >
        <RefreshCw className={refreshing ? "animate-spin" : undefined} />
        Refresh
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={downloading}
        onClick={() => void downloadDatabase()}
      >
        <Database />
        {downloading ? "Exporting…" : "Database"}
      </Button>
    </>
  );
}
