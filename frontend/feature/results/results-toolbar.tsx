"use client";

import { useTransition } from "react";
import { Database, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { useActionAuth } from "@/components/action-auth-provider";
import { Button } from "@/components/ui/button";
import { refreshData } from "@/lib/cacheActions";
import { getPublicApiUrl } from "@/lib/env";

export function ResultsToolbar() {
  const router = useRouter();
  const { requireAuth } = useActionAuth();
  const [refreshing, startRefresh] = useTransition();

  // The whole database leaves the server, so it is gated like the mutating actions. The backend
  // answers with an attachment, so navigating to it downloads without leaving the page.
  async function downloadDatabase() {
    if (await requireAuth()) {
      window.location.href = `${getPublicApiUrl()}/api/database/export`;
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={refreshing}
        onClick={() =>
          startRefresh(async () => {
            await refreshData();
            router.refresh();
          })
        }
      >
        <RefreshCw className={refreshing ? "animate-spin" : undefined} />
        Refresh
      </Button>
      <Button variant="outline" size="sm" onClick={() => void downloadDatabase()}>
        <Database />
        Database
      </Button>
    </>
  );
}
