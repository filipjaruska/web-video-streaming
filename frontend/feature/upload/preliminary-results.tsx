"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import { ContentCharacteristicsCard } from "@/feature/analysis/content-characteristics-card";
import { useVideoAnalysis } from "@/hooks/useVideoAnalysis";
import { useVideoTranscodes } from "@/hooks/useVideoTranscodes";
import { formatBitrate, ladderColor, ladderLabel } from "@/lib/analysisFormat";
import {
  collectVmafEntries,
  pickSourceTarget,
  pickStaticTranscode,
  pickTranscodeTargets,
} from "@/lib/analysisTargets";
import { signed } from "@/lib/results/format";
import type { AnalysisTarget, DerivedLadderDocument } from "@/lib/videoAnalysisApi";

const LADDERS = ["static", "dynamic", "animation"] as const;

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="animate-rise space-y-3 border-t pt-5">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** Top-rung harmonic VMAF of a packaged ladder, once its rungs are scored. */
function topRungVmaf(target: AnalysisTarget | undefined): number | null {
  const entries = collectVmafEntries(target?.series.vmafByFormat).filter(
    (entry) => entry.format === "hls",
  );
  const top = entries.toSorted(
    (a, b) => (b.data.summary.bitrateBps ?? 0) - (a.data.summary.bitrateBps ?? 0),
  )[0];
  return top?.data.summary.harmonicMean ?? null;
}

function rungSpan(ladder: DerivedLadderDocument | undefined): string | null {
  const rates = ladder?.variants.map((variant) => variant.bitrateBps) ?? [];
  if (rates.length === 0) {
    return null;
  }
  return `${rates.length} rungs, ${formatBitrate(Math.min(...rates))} to ${formatBitrate(Math.max(...rates))}`;
}

/**
 * What processing has produced so far, in the order the pipeline produces it. Each block appears
 * once its data exists, so the page fills in while the clip is still being processed.
 */
export function PreliminaryResults({
  routeId,
  processing,
  thumbnailUrl,
}: {
  routeId: string;
  processing: boolean;
  thumbnailUrl: string | null;
}) {
  const { data } = useVideoAnalysis(routeId, { poll: processing });
  const { transcodes } = useVideoTranscodes(routeId, { poll: processing });

  const targets = data?.targets ?? [];
  const source = pickSourceTarget(targets);
  const staticRun = pickStaticTranscode(targets);
  const series = staticRun?.series;
  const packaged = pickTranscodeTargets(targets);
  const hasContent = !!source?.series.siti?.si.length;
  const anyLadder = transcodes.length > 0;
  const derived = { dynamic: series?.derivedLadder, animation: series?.animationLadder };
  const tuning = series?.tuningComparison;
  const comparison = series?.ladderComparison;
  const watchable = transcodes.some((item) => item.status === "succeeded");

  if (!thumbnailUrl && !hasContent && !anyLadder) {
    return (
      <p className="text-sm text-muted-foreground">
        Results appear here as each step finishes, starting with the source analysis.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {(thumbnailUrl || watchable) && (
        <div className="flex flex-wrap items-end gap-4 animate-rise">
          {thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt=""
              className="aspect-video w-56 rounded-sm border object-cover"
            />
          )}
          {watchable && (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/${routeId}`}>Watch now</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/${routeId}/results`}>All results</Link>
              </Button>
            </div>
          )}
        </div>
      )}

      {hasContent && (
        <Block title="Content">
          <ContentCharacteristicsCard
            series={source?.series}
            durationSec={source?.series.siti?.timeSec?.at(-1) ?? null}
          />
        </Block>
      )}

      {anyLadder && (
        <Block title="Ladders">
          <DataTable
            head={
              <tr className="border-b border-foreground/20">
                <DataHead>Ladder</DataHead>
                <DataHead>State</DataHead>
                <DataHead>Rungs</DataHead>
                <DataHead numeric>Top rung VMAF</DataHead>
              </tr>
            }
          >
            {LADDERS.map((kind) => {
              const run = transcodes.find((item) => item.ladderKind === kind);
              const target = packaged.find((item) => item.ladderKind === kind);
              const vmaf = topRungVmaf(target);
              return (
                <DataRow key={kind}>
                  <DataCell mono={false} className="whitespace-nowrap">
                    <span
                      aria-hidden
                      className="mr-2 inline-block size-2 rounded-full"
                      style={{ backgroundColor: ladderColor(kind) }}
                    />
                    {ladderLabel(kind)}
                  </DataCell>
                  <DataCell mono={false}>
                    <StatusBadge status={run?.status ?? "pending"} />
                  </DataCell>
                  <DataCell mono={false} className="text-muted-foreground">
                    {kind === "static"
                      ? "fixed table"
                      : (rungSpan(derived[kind]) ?? "not derived yet")}
                  </DataCell>
                  <DataCell numeric last>
                    {vmaf != null ? vmaf.toFixed(2) : "—"}
                  </DataCell>
                </DataRow>
              );
            })}
          </DataTable>
        </Block>
      )}

      {tuning && !tuning.error && (
        <Block title="Codec tuning">
          <p className="text-sm">
            <span className="font-mono tabular">{signed(tuning.meanVmafDelta, 3)}</span> VMAF and{" "}
            <span className="font-mono tabular">{signed(tuning.bdRatePercent)} %</span> BD-rate with{" "}
            <code className="font-mono text-xs">-tune {tuning.tune}</code>, over{" "}
            {tuning.pairs.length} matched samples.
          </p>
        </Block>
      )}

      {comparison && comparison.ladders.length > 0 && (
        <Block title="Against the static ladder">
          <DataTable
            head={
              <tr className="border-b border-foreground/20">
                <DataHead>Ladder</DataHead>
                <DataHead numeric>BD-rate (%)</DataHead>
                <DataHead numeric>BD-VMAF</DataHead>
              </tr>
            }
          >
            {comparison.ladders.map((entry) => (
              <DataRow key={entry.ladderKind}>
                <DataCell mono={false}>{ladderLabel(entry.ladderKind)}</DataCell>
                <DataCell numeric>{entry.error ? "—" : signed(entry.bdRatePercent)}</DataCell>
                <DataCell numeric last>
                  {entry.error ? "—" : signed(entry.bdVmaf)}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </Block>
      )}
    </div>
  );
}
