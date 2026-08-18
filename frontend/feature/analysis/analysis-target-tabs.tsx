"use client";

import { useMemo, useState } from "react";
import type {
  AnalysisTarget,
  FormatVmafSeries,
  FutureTestDescriptor,
  VmafSeriesData,
} from "@/lib/videoAnalysisApi";
import { splitSourceAnalysisTree } from "@/lib/analysisTree";
import { AnalysisTree } from "@/feature/analysis/analysis-tree";
import { SitiChart } from "@/feature/analysis/siti-chart";
import { VmafChart } from "@/feature/analysis/vmaf-chart";
import { RdScatterChart } from "@/feature/analysis/rd-scatter-chart";
import { TranscodeAnalysisCard } from "@/feature/analysis/transcode-analysis-card";
import { TuningComparisonCard } from "@/feature/analysis/tuning-comparison-card";
import { formatTargetStatus } from "@/lib/analysisLabels";
import { getPublicApiUrl } from "@/lib/env";
import { getHlsVariantUrl } from "@/lib/streamingLabels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AnalysisTargetTabsProps {
  routeId: string;
  targets: AnalysisTarget[];
  futureTests: FutureTestDescriptor[];
}

type FormatKey = "hls" | "dash";

/** Keeps the sign visible on deltas, so a saving reads as "-32" rather than "32". */
function formatSigned(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function collectVmafEntries(
  byFormat: FormatVmafSeries | undefined,
): Array<{ format: FormatKey; label: string; data: VmafSeriesData }> {
  if (!byFormat) {
    return [];
  }

  const entries: Array<{
    format: FormatKey;
    label: string;
    data: VmafSeriesData;
  }> = [];

  for (const format of ["hls", "dash"] as const) {
    const map = byFormat[format];
    if (!map) {
      continue;
    }
    for (const [label, data] of Object.entries(map)) {
      entries.push({ format, label, data });
    }
  }

  return entries;
}

function RdSummaryTable({
  entries,
}: {
  entries: Array<{ format: FormatKey; label: string; data: VmafSeriesData }>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Format</th>
            <th className="py-2 pr-3 font-medium">Rung</th>
            <th className="py-2 pr-3 font-medium">Bitrate</th>
            <th className="py-2 pr-3 font-medium">Mean VMAF</th>
            <th className="py-2 pr-3 font-medium">Harmonic</th>
            <th className="py-2 font-medium">Min</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const bps = entry.data.summary.bitrateBps;
            const bitrate =
              bps == null
                ? "—"
                : bps >= 1_000_000
                  ? `${(bps / 1_000_000).toFixed(2)} Mb/s`
                  : `${(bps / 1000).toFixed(0)} kb/s`;
            return (
              <tr
                key={`${entry.format}-${entry.label}`}
                className="border-b border-border/50 last:border-b-0"
              >
                <td className="py-1.5 pr-3 uppercase">{entry.format}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{entry.label}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{bitrate}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">
                  {entry.data.summary.mean.toFixed(2)}
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs">
                  {entry.data.summary.harmonicMean.toFixed(2)}
                </td>
                <td className="py-1.5 font-mono text-xs">
                  {entry.data.summary.min.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AnalysisTargetTabs({
  routeId,
  targets,
  futureTests,
}: AnalysisTargetTabsProps) {
  const source = targets.find((target) => target.kind === "source");
  const transcodes = targets.filter((target) => target.kind === "transcode");
  const staticTranscode =
    transcodes.find((t) => t.ladderKind === "static") ??
    transcodes.find((t) => t.series.encodeGrid?.length);
  const dynamicTranscode = transcodes.find((t) => t.ladderKind === "dynamic");
  const packagedWithVmaf = transcodes.filter(
    (t) => collectVmafEntries(t.series.vmafByFormat).length > 0,
  );

  const [selectedTranscodeId, setSelectedTranscodeId] = useState<string | null>(
    null,
  );
  const selectedTranscode =
    packagedWithVmaf.find((t) => t.id === selectedTranscodeId) ??
    packagedWithVmaf.find((t) => t.label.includes("(active)")) ??
    packagedWithVmaf[0];

  const vmafEntries = useMemo(
    () => collectVmafEntries(selectedTranscode?.series.vmafByFormat),
    [selectedTranscode],
  );

  const formats = useMemo(() => {
    const set = new Set<FormatKey>();
    for (const entry of vmafEntries) {
      set.add(entry.format);
    }
    return Array.from(set);
  }, [vmafEntries]);

  const [selectedFormat, setSelectedFormat] = useState<FormatKey | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  const resolvedFormat = selectedFormat ?? formats[0] ?? "hls";
  const labelsForFormat = vmafEntries
    .filter((entry) => entry.format === resolvedFormat)
    .map((entry) => entry.label);
  const resolvedLabel = selectedLabel ?? labelsForFormat[0] ?? null;
  const selectedSeries =
    resolvedLabel == null
      ? undefined
      : vmafEntries.find(
          (entry) =>
            entry.format === resolvedFormat && entry.label === resolvedLabel,
        )?.data;

  const encodeGrid = staticTranscode?.series.encodeGrid ?? [];
  const derivedLadder = staticTranscode?.series.derivedLadder;
  const ladderComparison = staticTranscode?.series.ladderComparison;

  const { mediaNodes, sitiNode } = useMemo(
    () =>
      source
        ? splitSourceAnalysisTree(source.tree.children)
        : { mediaNodes: [], sitiNode: undefined },
    [source],
  );
  const hasSitiSeries =
    !!source?.series.siti && source.series.siti.si.length > 0;

  const videoSrc = useMemo(
    () => getHlsVariantUrl(getPublicApiUrl(), routeId, "360p"),
    [routeId],
  );

  return (
    <Tabs defaultValue="source">
      <TabsList>
        <TabsTrigger value="source">Source</TabsTrigger>
        <TabsTrigger value="transcodes">
          Transcodes{transcodes.length > 0 ? ` (${transcodes.length})` : ""}
        </TabsTrigger>
        <TabsTrigger value="quality">Quality tests</TabsTrigger>
        <TabsTrigger value="tuning">Tuning</TabsTrigger>
      </TabsList>

      <TabsContent value="source" className="mt-4 space-y-4">
        {source ? (
          <>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium">{source.label}</h2>
              <Badge variant="outline">{formatTargetStatus(source.status)}</Badge>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Media metadata</CardTitle>
                <CardDescription>
                  MediaInfo-style tree from ffprobe on the original upload.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AnalysisTree nodes={mediaNodes} defaultOpen />
              </CardContent>
            </Card>
            {(hasSitiSeries || sitiNode) && (
              <SitiChart
                data={source.series.siti}
                stats={sitiNode}
                videoSrc={videoSrc}
                videoLabel="Preview (HLS 360p)"
              />
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No source analysis yet.</p>
        )}
      </TabsContent>

      <TabsContent value="transcodes" className="mt-4 space-y-4">
        {transcodes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No transcodes yet</CardTitle>
              <CardDescription>
                After HLS/DASH packaging finishes, each transcode appears here
                with probe metadata and per-rendition SI/TI. A second dynamic
                ladder packaging may follow encode-grid derivation.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          transcodes.map((target, index) => (
            <TranscodeAnalysisCard
              key={target.id}
              target={target}
              transcodeNumber={index + 1}
              videoSrc={getHlsVariantUrl(
                getPublicApiUrl(),
                routeId,
                "360p",
                target.transcodeId,
              )}
            />
          ))
        )}
      </TabsContent>

      <TabsContent value="quality" className="mt-4 space-y-4">
        {ladderComparison && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Dynamic vs static ladder (BD-rate)
              </CardTitle>
              <CardDescription>
                Measured on the packaged renditions of both ladders. Negative
                BD-rate means the derived ladder delivers the same quality for
                fewer bits.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ladderComparison.error ? (
                <p className="text-sm text-muted-foreground">
                  {ladderComparison.error}
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <div
                      className={`text-2xl font-semibold tabular-nums ${
                        ladderComparison.bdRatePercent < 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {formatSigned(ladderComparison.bdRatePercent)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      BD-rate over harmonic VMAF{" "}
                      {ladderComparison.overlapLowVmaf.toFixed(1)}–
                      {ladderComparison.overlapHighVmaf.toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">
                      {ladderComparison.bitrateSavingPercent != null
                        ? `${formatSigned(ladderComparison.bitrateSavingPercent)}%`
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Bitrate at equal quality
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">
                      {ladderComparison.vmafGainAtEqualBitrate != null
                        ? formatSigned(ladderComparison.vmafGainAtEqualBitrate)
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      VMAF at equal bitrate
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(encodeGrid.length > 0 || derivedLadder) && (
          <>
            <RdScatterChart
              encodeGrid={encodeGrid}
              derivedLadder={derivedLadder}
            />
            {derivedLadder && derivedLadder.variants.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Derived ladder ({derivedLadder.name})
                  </CardTitle>
                  <CardDescription>
                    Hull operating points at a shared slope
                    {derivedLadder.lambda != null
                      ? ` (λ = ${derivedLadder.lambda.toFixed(2)} VMAF per bitrate doubling)`
                      : ""}
                    , used as CBR targets for the second (dynamic) packaging run
                    {dynamicTranscode ? " — see Transcodes tab." : "."}
                    {derivedLadder.windowed
                      ? " Scored on SI/TI-selected complexity windows."
                      : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Rung</th>
                          <th className="py-2 pr-3 font-medium">Resolution</th>
                          <th className="py-2 pr-3 font-medium">Bitrate</th>
                          <th className="py-2 pr-3 font-medium">CRF</th>
                          <th className="py-2 pr-3 font-medium">Pred. VMAF</th>
                          <th className="py-2 font-medium">Pred. harm. VMAF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {derivedLadder.variants.map((v) => (
                          <tr
                            key={v.label}
                            className="border-b border-border/50 last:border-b-0"
                          >
                            <td className="py-1.5 pr-3 font-mono text-xs">
                              {v.label}
                            </td>
                            <td className="py-1.5 pr-3 font-mono text-xs">
                              {v.resolution.replace(":", "×")}
                            </td>
                            <td className="py-1.5 pr-3 font-mono text-xs">
                              {v.bitrate}
                            </td>
                            <td className="py-1.5 pr-3 font-mono text-xs">
                              {v.crf ?? "—"}
                            </td>
                            <td className="py-1.5 pr-3 font-mono text-xs">
                              {v.predictedVmaf != null
                                ? v.predictedVmaf.toFixed(2)
                                : "—"}
                            </td>
                            <td className="py-1.5 font-mono text-xs">
                              {v.predictedVmafHarmonic != null
                                ? v.predictedVmafHarmonic.toFixed(2)
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Packaged ladder VMAF</CardTitle>
                <CardDescription>
                  Full-reference scores for each packaged HLS/DASH rung vs
                  source. Compare static vs dynamic ladders when both exist.
                </CardDescription>
              </div>
              <Badge variant={vmafEntries.length === 0 ? "secondary" : "outline"}>
                {vmafEntries.length === 0 ? "No data yet" : "Ready"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {packagedWithVmaf.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {packagedWithVmaf.map((t) => (
                  <Button
                    key={t.id}
                    size="sm"
                    variant={
                      selectedTranscode?.id === t.id ? "default" : "outline"
                    }
                    onClick={() => {
                      setSelectedTranscodeId(t.id);
                      setSelectedFormat(null);
                      setSelectedLabel(null);
                    }}
                  >
                    {t.ladderKind === "dynamic"
                      ? "Dynamic"
                      : t.ladderKind === "static"
                        ? "Static"
                        : t.label}
                  </Button>
                ))}
              </div>
            )}

            {vmafEntries.length > 0 ? (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-medium">
                    Rate–distortion summary
                  </h3>
                  <RdSummaryTable entries={vmafEntries} />
                </div>

                <div className="flex flex-wrap gap-2">
                  {formats.map((format) => (
                    <Button
                      key={format}
                      size="sm"
                      variant={
                        resolvedFormat === format ? "default" : "outline"
                      }
                      onClick={() => {
                        setSelectedFormat(format);
                        setSelectedLabel(null);
                      }}
                    >
                      {format.toUpperCase()}
                    </Button>
                  ))}
                </div>

                {labelsForFormat.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {labelsForFormat.map((label) => (
                      <Button
                        key={label}
                        size="sm"
                        variant={
                          resolvedLabel === label ? "default" : "outline"
                        }
                        onClick={() => setSelectedLabel(label)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                )}

                {selectedSeries && resolvedLabel && (
                  <VmafChart
                    data={selectedSeries}
                    label={resolvedLabel}
                    format={resolvedFormat}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No packaged VMAF yet. Re-upload — the pipeline packages a static
                ladder (VMAF ~40%), then runs encode-grid (~45–76%) + crossover and a
                second dynamic packaging when derivation succeeds.
              </p>
            )}
          </CardContent>
        </Card>

        {futureTests.map((test) => (
          <Card key={test.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{test.label}</CardTitle>
                  <CardDescription>
                    {test.label} quality metric comparing source to transcoded
                    outputs.
                  </CardDescription>
                </div>
                <Badge variant="secondary">
                  {formatTargetStatus(test.status)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Scaffolded for a future pipeline step.
              </p>
            </CardContent>
          </Card>
        ))}
      </TabsContent>

      <TabsContent value="tuning" className="mt-4">
        <TuningComparisonCard />
      </TabsContent>
    </Tabs>
  );
}
