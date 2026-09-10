"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AnalysisTargetTabs } from "@/feature/analysis/analysis-target-tabs";
import {
  DEFAULT_ANALYSIS_TAB,
  isAnalysisTab,
  type AnalysisTab,
} from "@/lib/analysisTabs";
import { useVideoAnalysis } from "@/hooks/useVideoAnalysis";
import { useVideoTranscodes } from "@/hooks/useVideoTranscodes";
import { Button } from "@/components/ui/button";

interface AnalysisPageClientProps {
  routeId: string;
  /** Tab to open, already validated server-side from the `?tab=` query. */
  initialTab?: AnalysisTab;
}

export function AnalysisPageClient({
  routeId,
  initialTab = DEFAULT_ANALYSIS_TAB,
}: AnalysisPageClientProps) {
  const { data, error, loading, reload, isPolling } = useVideoAnalysis(routeId);
  const { transcodes } = useVideoTranscodes(routeId);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AnalysisTab>(initialTab);

  // Mirrors the open tab into the URL so a view can be linked to and shared. `replace` rather
  // than `push` keeps the back button pointing at the previous page, not the previous tab.
  const onTabChange = useCallback(
    (tab: string) => {
      if (!isAnalysisTab(tab)) {
        return;
      }

      setActiveTab(tab);
      router.replace(`?tab=${tab}`, { scroll: false });
    },
    [router],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {data?.updatedAtUtc
            ? `Last updated ${new Date(data.updatedAtUtc).toLocaleString()}`
            : "Analysis has not been written yet"}
          {isPolling ? " · Refreshing while processing…" : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void reload()}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {loading && !data && (
        <p className="text-sm text-muted-foreground">Loading analysis…</p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && (
        <AnalysisTargetTabs
          routeId={routeId}
          targets={data.targets}
          futureTests={data.futureTests}
          transcodeRuns={transcodes}
          activeTab={activeTab}
          onTabChange={onTabChange}
        />
      )}
    </div>
  );
}
