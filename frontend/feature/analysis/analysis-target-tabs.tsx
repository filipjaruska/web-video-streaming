"use client";

import { useMemo } from "react";
import type {
  AnalysisTarget,
  FutureTestDescriptor,
} from "@/lib/videoAnalysisApi";
import { splitSourceAnalysisTree } from "@/lib/analysisTree";
import { AnalysisTree } from "@/feature/analysis/analysis-tree";
import { SitiChart } from "@/feature/analysis/siti-chart";
import { TranscodeAnalysisCard } from "@/feature/analysis/transcode-analysis-card";
import { formatTargetStatus } from "@/lib/analysisLabels";
import { getPublicApiUrl } from "@/lib/env";
import { getHlsVariantUrl } from "@/lib/streamingLabels";
import { Badge } from "@/components/ui/badge";
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

export function AnalysisTargetTabs({
  routeId,
  targets,
  futureTests,
}: AnalysisTargetTabsProps) {
  const source = targets.find((target) => target.kind === "source");
  const transcodes = targets.filter((target) => target.kind === "transcode");
  const { mediaNodes, sitiNode } = useMemo(
    () =>
      source
        ? splitSourceAnalysisTree(source.tree.children)
        : { mediaNodes: [], sitiNode: undefined },
    [source],
  );
  const hasSitiSeries =
    !!source?.series.siti && source.series.siti.si.length > 0;

  // HLS 360p seeks reliably across the full timeline; progressive MP4 often stalls mid-file.
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
                with probe metadata and per-rendition SI/TI.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          transcodes.map((target, index) => (
            <TranscodeAnalysisCard
              key={target.id}
              target={target}
              transcodeNumber={index + 1}
              videoSrc={videoSrc}
            />
          ))
        )}
      </TabsContent>

      <TabsContent value="quality" className="mt-4 space-y-4">
        {futureTests.map((test) => (
          <Card key={test.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{test.label}</CardTitle>
                  <CardDescription>
                    {test.id === "vmaf"
                      ? "Video Multi-Method Assessment Fusion scores comparing source to transcoded outputs."
                      : `${test.label} quality metric comparing source to transcoded outputs.`}
                  </CardDescription>
                </div>
                <Badge variant="secondary">Not implemented</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Scaffolded for a future pipeline step. Results will land as series
                under this test once implemented.
              </p>
            </CardContent>
          </Card>
        ))}
      </TabsContent>
    </Tabs>
  );
}
