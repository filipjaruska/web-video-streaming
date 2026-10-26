"use client";

import { useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { Section } from "@/components/section";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalysisTree } from "@/feature/analysis/analysis-tree";
import { TranscodeAnalysisCard } from "@/feature/analysis/transcode-analysis-card";
import { useVideoAnalysis } from "@/hooks/useVideoAnalysis";
import { pickSourceTarget, pickTranscodeTargets } from "@/lib/analysisTargets";
import { splitSourceAnalysisTree } from "@/lib/analysisTree";
import { getPublicApiUrl } from "@/lib/env";
import { getHlsVariantUrl } from "@/lib/streamingLabels";

/** Probe metadata of the source and every packaging run, as the backend recorded it. */
export function VideoRaw({ routeId, poll }: { routeId: string; poll: boolean }) {
  const { data, error, loading } = useVideoAnalysis(routeId, { poll });
  const targets = useMemo(() => data?.targets ?? [], [data]);
  const source = pickSourceTarget(targets);
  const transcodes = pickTranscodeTargets(targets);
  const { mediaNodes } = useMemo(
    () =>
      source
        ? splitSourceAnalysisTree(source.tree.children)
        : { mediaNodes: [], sitiNode: undefined },
    [source],
  );

  if (loading && !data) {
    return <Skeleton className="h-72 w-full" />;
  }
  if (error) {
    return <ErrorBanner title="Analysis unavailable" message={error} />;
  }

  return (
    <div>
      <Section id="source" title="Source" description="ffprobe on the uploaded file.">
        {source ? (
          <AnalysisTree nodes={mediaNodes} defaultOpen />
        ) : (
          <EmptyState title="Not probed yet" />
        )}
      </Section>
      <Section id="packaging" title="Packaging runs">
        {transcodes.length === 0 ? (
          <EmptyState title="Nothing packaged yet" />
        ) : (
          transcodes.map((target, index) => (
            <TranscodeAnalysisCard
              key={target.id}
              target={target}
              transcodeNumber={index + 1}
              videoSrc={getHlsVariantUrl(getPublicApiUrl(), routeId, "360p", target.transcodeId)}
            />
          ))
        )}
      </Section>
    </div>
  );
}
