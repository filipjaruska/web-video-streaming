"use client";

import { useMemo, useState } from "react";
import type {
  AnalysisTarget,
  FutureTestDescriptor,
} from "@/lib/videoAnalysisApi";
import { splitSourceAnalysisTree } from "@/lib/analysisTree";
import { AnalysisTree } from "@/feature/analysis/analysis-tree";
import { SitiChart } from "@/feature/analysis/siti-chart";
import { VmafChart } from "@/feature/analysis/vmaf-chart";
import { RdScatterChart } from "@/feature/analysis/rd-scatter-chart";
import { DerivedLadderTable } from "@/feature/analysis/derived-ladder-table";
import { LadderComparisonCard } from "@/feature/analysis/ladder-comparison-card";
import { ContentCharacteristicsCard } from "@/feature/analysis/content-characteristics-card";
import { PipelineCostCard } from "@/feature/analysis/pipeline-cost-card";
import { TranscodeAnalysisCard } from "@/feature/analysis/transcode-analysis-card";
import { TuningComparisonCard } from "@/feature/analysis/tuning-comparison-card";
import type { VideoTranscodeListItem } from "@/lib/videoTranscodesApi";
import type { AnalysisTab } from "@/lib/analysisTabs";
import { formatTargetStatus } from "@/lib/analysisLabels";
import {
  formatBitrate,
  formatNumber,
  ladderLabel,
} from "@/lib/analysisFormat";
import {
  collectVmafEntries,
  pickPackagedWithVmaf,
  pickSourceTarget,
  pickStaticTranscode,
  pickTranscodeTargets,
  type FormatKey,
  type VmafEntry,
} from "@/lib/analysisTargets";
import { DataCell, DataRow, DataTable } from "@/components/ui/data-table";
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
  /** Packaging runs, used for the pipeline-cost view. */
  transcodeRuns?: VideoTranscodeListItem[];
  activeTab: AnalysisTab;
  onTabChange: (tab: string) => void;
}

/**
 * Measured quality per packaged rendition.
 *
 * CAMBI and the NEG model are shown alongside the classic score because both are computed on every
 * run and neither is visible from the mean alone: NEG withholds credit for sharpening that did not
 * restore detail, and CAMBI is the banding metric the animation ladder is selected against.
 */
function RdSummaryTable({ entries }: { entries: VmafEntry[] }) {
  return (
    <DataTable
      headers={[
        "Format",
        "Rung",
        "Bitrate",
        "Mean VMAF",
        "Harmonic",
        "Min",
        "NEG harm.",
        "CAMBI",
      ]}
    >
      {entries.map((entry) => {
        const summary = entry.data.summary;
        const neg = entry.data.summaryByModel?.neg;
        return (
          <DataRow key={`${entry.format}-${entry.label}`}>
            <DataCell mono={false} className="uppercase">
              {entry.format}
            </DataCell>
            <DataCell>{entry.label}</DataCell>
            <DataCell>{formatBitrate(summary.bitrateBps)}</DataCell>
            <DataCell>{formatNumber(summary.mean)}</DataCell>
            <DataCell>{formatNumber(summary.harmonicMean)}</DataCell>
            <DataCell>{formatNumber(summary.min)}</DataCell>
            <DataCell title="vmaf_v0.6.1neg — rejects enhancement gain from sharpening or added contrast.">
              {formatNumber(neg?.harmonicMean)}
            </DataCell>
            <DataCell
              last
              title="Banding detector. Lower is better, and it is measured on the encode itself rather than against the source."
            >
              {formatNumber(summary.cambi)}
            </DataCell>
          </DataRow>
        );
      })}
    </DataTable>
  );
}

export function AnalysisTargetTabs({
  routeId,
  targets,
  futureTests,
  transcodeRuns = [],
  activeTab,
  onTabChange,
}: AnalysisTargetTabsProps) {
  const source = pickSourceTarget(targets);
  const transcodes = pickTranscodeTargets(targets);
  const staticTranscode = pickStaticTranscode(targets);
  const packagedWithVmaf = pickPackagedWithVmaf(targets);

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
  const encodeGridAnimation = staticTranscode?.series.encodeGridAnimation ?? [];
  const derivedLadder = staticTranscode?.series.derivedLadder;
  const animationLadder = staticTranscode?.series.animationLadder;
  const animationSensitivity = staticTranscode?.series.animationLadderSensitivity;
  const ladderComparison = staticTranscode?.series.ladderComparison;
  const tuningComparison = staticTranscode?.series.tuningComparison;

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

  // Read off the SI/TI time axis, which covers the whole clip. Avoids parsing the metadata tree
  // for a number the series already carries.
  const sourceDurationSec = useMemo(() => {
    const times = source?.series.siti?.timeSec;
    return times?.length ? times[times.length - 1] : null;
  }, [source]);

  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList>
        <TabsTrigger value="content">Content</TabsTrigger>
        <TabsTrigger value="ladder">Ladder design</TabsTrigger>
        <TabsTrigger value="tuning">Codec tuning</TabsTrigger>
        <TabsTrigger value="cost">Pipeline cost</TabsTrigger>
        <TabsTrigger value="delivery">Delivery &amp; ABR</TabsTrigger>
        <TabsTrigger value="raw">
          Raw data{transcodes.length > 0 ? ` (${transcodes.length})` : ""}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="content" className="mt-4 space-y-4">
        {source ? (
          <>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium">{source.label}</h2>
              <Badge variant="outline">{formatTargetStatus(source.status)}</Badge>
            </div>
            <ContentCharacteristicsCard
              series={source.series}
              durationSec={sourceDurationSec}
            />
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

      <TabsContent value="ladder" className="mt-4 space-y-4">
        <LadderComparisonCard comparison={ladderComparison} />

        {encodeGrid.length > 0 || derivedLadder ? (
          <>
            <RdScatterChart
              encodeGrid={encodeGrid}
              derivedLadder={derivedLadder}
              crossoverBps={derivedLadder?.crossoverBps}
            />
            <DerivedLadderTable
              ladder={derivedLadder}
              caption="Envelope operating points, used as 2-pass VBR targets (maxrate 1.5×) for the dynamic packaging run."
            />

            {encodeGridAnimation.length > 0 && (
              <RdScatterChart
                encodeGrid={encodeGridAnimation}
                derivedLadder={animationLadder}
                crossoverBps={animationLadder?.crossoverBps}
                title="Rate–distortion (animation grid)"
              />
            )}
            <DerivedLadderTable
              ladder={animationLadder}
              sensitivity={animationSensitivity}
              caption="Same derivation re-run over the animation-tuned grid, with banding penalised in the selection."
            />
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No encode grid yet</CardTitle>
              <CardDescription>
                The rate–distortion sweep runs after the static ladder is packaged. Its points are
                what both derived ladders are built from.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="tuning" className="mt-4">
        <TuningComparisonCard tuning={tuningComparison} />
      </TabsContent>

      <TabsContent value="cost" className="mt-4">
        <PipelineCostCard
          transcodes={transcodeRuns}
          gridSizes={{
            generic: encodeGrid.length,
            animation: encodeGridAnimation.length,
          }}
          sourceDurationSec={sourceDurationSec}
        />
      </TabsContent>

      <TabsContent value="delivery" className="mt-4 space-y-4">
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
                    {ladderLabel(t.ladderKind)}
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

      </TabsContent>

      <TabsContent value="raw" className="mt-4 space-y-4">
        {source && (
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
        )}

        {transcodes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No transcodes yet</CardTitle>
              <CardDescription>
                After HLS/DASH packaging finishes, each transcode appears here with probe
                metadata and per-rendition SI/TI. Two derived ladders follow once the encode
                grids complete.
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
    </Tabs>
  );
}
