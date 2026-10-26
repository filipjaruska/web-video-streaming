"use client";

import { useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { Section } from "@/components/section";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentCharacteristicsCard } from "@/feature/analysis/content-characteristics-card";
import { DerivedLadderTable } from "@/feature/analysis/derived-ladder-table";
import { LadderComparisonCard } from "@/feature/analysis/ladder-comparison-card";
import { PipelineCostCard } from "@/feature/analysis/pipeline-cost-card";
import { RdScatterChart } from "@/feature/analysis/rd-scatter-chart";
import { SitiChart } from "@/feature/analysis/siti-chart";
import { TuningComparisonCard } from "@/feature/analysis/tuning-comparison-card";
import { useVideoAnalysis } from "@/hooks/useVideoAnalysis";
import { useVideoTranscodes } from "@/hooks/useVideoTranscodes";
import { pickSourceTarget, pickStaticTranscode } from "@/lib/analysisTargets";
import { splitSourceAnalysisTree } from "@/lib/analysisTree";
import { getPublicApiUrl } from "@/lib/env";
import { getHlsVariantUrl } from "@/lib/streamingLabels";

import { PackagedVmaf } from "./packaged-vmaf";

export const CLIP_RESULT_SECTIONS = [
  { id: "content", title: "Content" },
  { id: "ladder", title: "Ladders" },
  { id: "tuning", title: "Codec tuning" },
  { id: "vmaf", title: "Packaged quality" },
  { id: "cost", title: "Pipeline cost" },
] as const;

function SectionIndex() {
  return (
    <nav aria-label="Sections" className="hidden xl:block">
      <ol className="sticky top-20 space-y-1 border-l text-sm">
        {CLIP_RESULT_SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="-ml-px block border-l border-transparent py-1 pl-3 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {section.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** One clip's results, in the order of its appendix in the thesis. */
export function ClipResults({ routeId }: { routeId: string }) {
  const { data, error, loading, isPolling } = useVideoAnalysis(routeId);
  const { transcodes } = useVideoTranscodes(routeId);

  const targets = useMemo(() => data?.targets ?? [], [data]);
  const source = pickSourceTarget(targets);
  const staticRun = pickStaticTranscode(targets);
  const { sitiNode } = useMemo(
    () =>
      source
        ? splitSourceAnalysisTree(source.tree.children)
        : { mediaNodes: [], sitiNode: undefined },
    [source],
  );
  const durationSec = source?.series.siti?.timeSec?.at(-1) ?? null;
  const previewSrc = useMemo(() => getHlsVariantUrl(getPublicApiUrl(), routeId, "360p"), [routeId]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (error) {
    return <ErrorBanner title="Results unavailable" message={error} />;
  }

  const series = staticRun?.series;
  const encodeGrid = series?.encodeGrid ?? [];
  const animationGrid = series?.encodeGridAnimation ?? [];
  // Default-setting samples taken while refining the pooled ladder count towards the grid's cost
  // but are not the tune, so the animation scatter leaves them out.
  const tunedSamples = animationGrid.filter((point) => point.setting !== "default");

  return (
    <div className="grid gap-10 xl:grid-cols-[11rem_minmax(0,1fr)]">
      <SectionIndex />
      <div>
        {isPolling && (
          <p className="mb-4 text-sm text-muted-foreground">
            Still processing. New results appear here as each step finishes.
          </p>
        )}

        <Section id="content" title="Content">
          {source ? (
            <>
              <ContentCharacteristicsCard series={source.series} durationSec={durationSec} />
              {(source.series.siti?.si.length || sitiNode) && (
                <SitiChart
                  data={source.series.siti}
                  stats={sitiNode}
                  videoSrc={previewSrc}
                  videoLabel="Preview (HLS 360p)"
                />
              )}
            </>
          ) : (
            <EmptyState title="Not analysed yet" />
          )}
        </Section>

        <Section id="ladder" title="Ladders">
          <LadderComparisonCard comparison={series?.ladderComparison} />
          {encodeGrid.length > 0 || series?.derivedLadder ? (
            <>
              <RdScatterChart
                encodeGrid={encodeGrid}
                derivedLadder={series?.derivedLadder}
                crossoverBps={series?.derivedLadder?.crossoverBps}
              />
              <DerivedLadderTable
                ladder={series?.derivedLadder}
                caption="Content-adaptive ladder: hull operating points, encoded as 2-pass VBR targets with maxrate 1.5×."
              />
              {tunedSamples.length > 0 && (
                <RdScatterChart
                  encodeGrid={tunedSamples}
                  derivedLadder={series?.animationLadder}
                  crossoverBps={series?.animationLadder?.crossoverBps}
                  title="Rate–distortion, animation grid"
                />
              )}
              <DerivedLadderTable
                ladder={series?.animationLadder}
                sensitivity={series?.animationLadderSensitivity}
                caption="Animation-optimised ladder: both grids pooled, each rung free to take either setting, banding penalised in the selection."
              />
            </>
          ) : (
            <EmptyState title="No encode grid yet">
              The grid runs after the static ladder is packaged.
            </EmptyState>
          )}
        </Section>

        <Section id="tuning" title="Codec tuning">
          <TuningComparisonCard tuning={series?.tuningComparison} />
        </Section>

        <Section id="vmaf" title="Packaged quality">
          <PackagedVmaf targets={targets} />
        </Section>

        <Section id="cost" title="Pipeline cost">
          <PipelineCostCard
            transcodes={transcodes}
            gridSizes={{ generic: encodeGrid.length, animation: animationGrid.length }}
            sourceDurationSec={durationSec}
          />
        </Section>
      </div>
    </div>
  );
}
