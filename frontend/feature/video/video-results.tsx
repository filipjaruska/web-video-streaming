"use client";

import { useMemo, type ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { Section } from "@/components/section";
import { SectionIndex } from "@/components/section-index";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentCharacteristicsCard } from "@/feature/analysis/content-characteristics-card";
import { DerivedLadderTable } from "@/feature/analysis/derived-ladder-table";
import { LadderComparisonCard } from "@/feature/analysis/ladder-comparison-card";
import { PipelineCostCard } from "@/feature/analysis/pipeline-cost-card";
import { RdScatterChart } from "@/feature/analysis/rd-scatter-chart";
import { SitiChart } from "@/feature/analysis/siti-chart";
import { TuningComparisonCard } from "@/feature/analysis/tuning-comparison-card";
import { useScrollToHash } from "@/hooks/useScrollToHash";
import { useVideoAnalysis } from "@/hooks/useVideoAnalysis";
import { pickPreviewRung, pickSourceTarget, pickStaticTranscode } from "@/lib/analysisTargets";
import type { Chapter5Report } from "@/lib/results/chapter5";
import { splitSourceAnalysisTree } from "@/lib/analysisTree";
import { getPublicApiUrl } from "@/lib/env";
import { getHlsVariantUrl } from "@/lib/streamingLabels";

import { PackagedVmaf } from "./packaged-vmaf";

export const VIDEO_RESULT_SECTIONS = [
  { id: "content", title: "Content" },
  { id: "ladder", title: "Ladders" },
  { id: "tuning", title: "Codec tuning" },
  { id: "vmaf", title: "Packaged quality" },
  { id: "playback", title: "Playback" },
  { id: "cost", title: "Pipeline cost" },
] as const;

/** One video's results, in the order of its appendix in the thesis. */
export function VideoResults({
  routeId,
  poll,
  report,
  playback,
}: {
  routeId: string;
  /** Keep refreshing: the video is still being processed. */
  poll: boolean;
  /** This video's chapter 5 rows, reduced on the server. */
  report: Chapter5Report | null;
  /** The playback tables, rendered on the server from the same report. */
  playback: ReactNode;
}) {
  const { data, error, loading, isPolling } = useVideoAnalysis(routeId, { poll });
  // The sections render only once the analysis is in, after the browser has looked for the hash.
  useScrollToHash(data !== null);

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
  // From the static ladder, which exists first and whose rungs never change; a derived ladder may
  // have dropped 360p, which the helper steps down from.
  const previewRung = pickPreviewRung(staticRun);
  const previewSrc = getHlsVariantUrl(
    getPublicApiUrl(),
    routeId,
    previewRung,
    staticRun?.transcodeId,
  );

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
  const achievedPoints = (kind: string) =>
    series?.ladderComparison?.ladders.find((entry) => entry.ladderKind === kind)?.points;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 xl:grid-cols-[15rem_minmax(0,1fr)]">
      <SectionIndex sections={VIDEO_RESULT_SECTIONS} />
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
                  showStats={false}
                  videoSrc={previewSrc}
                  videoLabel={`HLS ${previewRung}`}
                />
              )}
            </>
          ) : (
            <EmptyState title="Not analysed yet" />
          )}
        </Section>

        <Section
          id="ladder"
          title="Ladders"
          description="Each derived ladder from its encode grid, rung by rung, then both against the static ladder."
        >
          {encodeGrid.length > 0 || series?.derivedLadder ? (
            <>
              <RdScatterChart
                encodeGrid={encodeGrid}
                derivedLadder={series?.derivedLadder}
                crossoverBps={series?.derivedLadder?.crossoverBps}
                title="Default grid with the content-adaptive rungs"
              />
              <DerivedLadderTable
                ladder={series?.derivedLadder}
                title="Content-adaptive ladder"
                achieved={achievedPoints("dynamic")}
              />
              {tunedSamples.length > 0 && (
                <RdScatterChart
                  encodeGrid={tunedSamples}
                  derivedLadder={series?.animationLadder}
                  crossoverBps={series?.animationLadder?.crossoverBps}
                  title="Animation grid with the animation-optimised rungs"
                  note="Each dot is one resolution × CRF encode with -tune animation. Rungs may come from either grid; stars sit at their predicted quality."
                />
              )}
              <DerivedLadderTable
                ladder={series?.animationLadder}
                title="Animation-optimised ladder"
                achieved={achievedPoints("animation")}
                sensitivity={series?.animationLadderSensitivity}
              />
            </>
          ) : (
            <EmptyState title="No encode grid yet">
              The grid runs after the static ladder is packaged.
            </EmptyState>
          )}
          <LadderComparisonCard comparison={series?.ladderComparison} />
        </Section>

        <Section id="tuning" title="Codec tuning">
          <TuningComparisonCard tuning={series?.tuningComparison} byCrf={report?.tuningByCrf[0]} />
        </Section>

        <Section id="vmaf" title="Packaged quality">
          <PackagedVmaf targets={targets} durationSec={durationSec} />
        </Section>

        <Section id="playback" title="Playback">
          {playback ?? <EmptyState title="Playback results unavailable" />}
        </Section>

        <Section id="cost" title="Pipeline cost">
          <PipelineCostCard
            timings={source?.series.stageTimings}
            overhead={report?.overhead[0]}
            sourceDurationSec={durationSec}
          />
        </Section>
      </div>
    </div>
  );
}
