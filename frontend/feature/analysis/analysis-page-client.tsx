"use client";

import { AnalysisTargetTabs } from "@/feature/analysis/analysis-target-tabs";
import { useVideoAnalysis } from "@/hooks/useVideoAnalysis";
import { Button } from "@/components/ui/button";

interface AnalysisPageClientProps {
  routeId: string;
}

export function AnalysisPageClient({ routeId }: AnalysisPageClientProps) {
  const { data, error, loading, reload, isPolling } = useVideoAnalysis(routeId);

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
          targets={data.targets}
          futureTests={data.futureTests}
        />
      )}
    </div>
  );
}
