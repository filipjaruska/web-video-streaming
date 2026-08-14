"use client";

import { memo } from "react";
import type { StreamingMethod, AbrAlgorithm } from "@/types/streaming";
import { SOURCE_RUN_ID, isSourceRun } from "@/types/streaming";
import type { VideoTranscodeListItem } from "@/lib/videoTranscodesApi";
import { getAbrLabel } from "@/lib/streamingLabels";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";

interface StreamingControlsProps {
  bestMode: boolean;
  onBestModeChange: (enabled: boolean) => void;
  streamingMethod: StreamingMethod;
  abrAlgorithm: AbrAlgorithm;
  /** Packaging selection: `SOURCE_RUN_ID` or a transcode GUID. */
  packagingRunId: string | null;
  transcodes: VideoTranscodeListItem[];
  transcodesLoading: boolean;
  onStreamingMethodChange: (method: StreamingMethod) => void;
  onAbrAlgorithmChange: (algorithm: AbrAlgorithm) => void;
  onPackagingRunChange: (packagingRunId: string) => void;
}

function protocolLabel(method: StreamingMethod): string {
  switch (method) {
    case "source":
      return "HTTP Range";
    case "hls":
      return "HLS";
    case "dash":
      return "DASH";
  }
}

function StreamingControlsComponent({
  bestMode,
  onBestModeChange,
  streamingMethod,
  abrAlgorithm,
  packagingRunId,
  transcodes,
  transcodesLoading,
  onStreamingMethodChange,
  onAbrAlgorithmChange,
  onPackagingRunChange,
}: StreamingControlsProps) {
  const sourceSelected = isSourceRun(packagingRunId);
  const isAdaptive = streamingMethod === "hls" || streamingMethod === "dash";
  const selectedTranscode =
    !sourceSelected && packagingRunId
      ? (transcodes.find((item) => item.id === packagingRunId) ?? null)
      : null;
  const succeeded = transcodes.filter((item) => item.status === "succeeded");

  const hlsDisabled = Boolean(selectedTranscode && !selectedTranscode.hasHls);
  const dashDisabled = Boolean(selectedTranscode && !selectedTranscode.hasDash);

  return (
    <Card className="mb-4">
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Switch
              id="best-mode"
              checked={bestMode}
              onCheckedChange={onBestModeChange}
            />
            <div>
              <Label htmlFor="best-mode" className="cursor-pointer">
                Best mode
              </Label>
              <p className="text-xs text-muted-foreground">
                {bestMode
                  ? "Auto settings locked — turn off to customize"
                  : "Manual selection unlocked"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={bestMode ? "default" : "outline"}>
              {bestMode ? "Best" : "Manual"}
            </Badge>
            {sourceSelected ? (
              <Badge variant="secondary">Source</Badge>
            ) : selectedTranscode ? (
              <Badge variant="secondary">
                {selectedTranscode.ladderKind === "dynamic"
                  ? "Dynamic"
                  : "Static"}
                {selectedTranscode.isActive ? " · active" : ""}
              </Badge>
            ) : null}
            <Badge variant="secondary">{protocolLabel(streamingMethod)}</Badge>
            <Badge variant="secondary">
              {isAdaptive ? getAbrLabel(abrAlgorithm) : "None"}
            </Badge>
          </div>
        </div>

        <Collapsible open={!bestMode}>
          <CollapsibleContent className="data-[state=closed]:animate-none">
            <div className="grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Packaging run</Label>
                <Select
                  value={packagingRunId ?? undefined}
                  onValueChange={onPackagingRunChange}
                  disabled={bestMode || transcodesLoading}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        transcodesLoading ? "Loading…" : "Select packaging run"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SOURCE_RUN_ID}>
                      Source (original)
                    </SelectItem>
                    {succeeded.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                        {item.isActive ? " (active)" : ""} ·{" "}
                        {formatShortDate(item.createdAtUtc)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Delivery</Label>
                <Select
                  value={streamingMethod}
                  onValueChange={(value) =>
                    onStreamingMethodChange(value as StreamingMethod)
                  }
                  disabled={bestMode || sourceSelected}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceSelected ? (
                      <SelectItem value="source">HTTP Range</SelectItem>
                    ) : (
                      <>
                        <SelectItem value="hls" disabled={hlsDisabled}>
                          HLS
                          {hlsDisabled ? " (unavailable)" : ""}
                        </SelectItem>
                        <SelectItem value="dash" disabled={dashDisabled}>
                          DASH
                          {dashDisabled ? " (unavailable)" : ""}
                        </SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>ABR algorithm</Label>
                <Select
                  value={isAdaptive ? abrAlgorithm : "none"}
                  onValueChange={(value) =>
                    onAbrAlgorithmChange(value as AbrAlgorithm)
                  }
                  disabled={bestMode || !isAdaptive}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {isAdaptive ? (
                      <>
                        <SelectItem value="hybrid">Hybrid</SelectItem>
                        <SelectItem value="throughput">
                          Throughput-Based
                        </SelectItem>
                        <SelectItem value="buffer">
                          Buffer-Based (BOLA)
                        </SelectItem>
                        <SelectItem value="baseline">Non-Adaptive</SelectItem>
                      </>
                    ) : (
                      <SelectItem value="none">None</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const StreamingControls = memo(StreamingControlsComponent);
