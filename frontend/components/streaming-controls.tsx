"use client";

import { memo } from "react";
import type { StreamingMethod, AbrAlgorithm } from "@/types/streaming";
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
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";

interface StreamingControlsProps {
  bestMode: boolean;
  onBestModeChange: (enabled: boolean) => void;
  streamingMethod: StreamingMethod;
  abrAlgorithm: AbrAlgorithm;
  transcodeId: string | null;
  transcodes: VideoTranscodeListItem[];
  transcodesLoading: boolean;
  onStreamingMethodChange: (method: StreamingMethod) => void;
  onAbrAlgorithmChange: (algorithm: AbrAlgorithm) => void;
  onTranscodeIdChange: (transcodeId: string) => void;
}

function protocolLabel(method: StreamingMethod): string {
  switch (method) {
    case "http-range":
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
  transcodeId,
  transcodes,
  transcodesLoading,
  onStreamingMethodChange,
  onAbrAlgorithmChange,
  onTranscodeIdChange,
}: StreamingControlsProps) {
  const isAdaptive = streamingMethod === "hls" || streamingMethod === "dash";
  const selectedTranscode =
    transcodes.find((item) => item.id === transcodeId) ?? null;
  const succeeded = transcodes.filter((item) => item.status === "succeeded");

  const hlsDisabled = Boolean(
    selectedTranscode && !selectedTranscode.hasHls,
  );
  const dashDisabled = Boolean(
    selectedTranscode && !selectedTranscode.hasDash,
  );

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
            {selectedTranscode && (
              <Badge variant="secondary">
                {selectedTranscode.ladderKind === "dynamic"
                  ? "Dynamic"
                  : "Static"}
                {selectedTranscode.isActive ? " · active" : ""}
              </Badge>
            )}
            <Badge variant="secondary">{protocolLabel(streamingMethod)}</Badge>
            {isAdaptive && (
              <Badge variant="secondary">{getAbrLabel(abrAlgorithm)}</Badge>
            )}
          </div>
        </div>

        <Collapsible open={!bestMode}>
          <CollapsibleContent className="data-[state=closed]:animate-none">
            <div className="grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Packaging run</Label>
                <Select
                  value={transcodeId ?? undefined}
                  onValueChange={onTranscodeIdChange}
                  disabled={bestMode || transcodesLoading || succeeded.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        transcodesLoading
                          ? "Loading…"
                          : succeeded.length === 0
                            ? "No packaging runs"
                            : "Select packaging run"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
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
                  disabled={bestMode}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http-range">HTTP Range</SelectItem>
                    <SelectItem value="hls" disabled={hlsDisabled}>
                      HLS
                      {hlsDisabled ? " (unavailable)" : ""}
                    </SelectItem>
                    <SelectItem value="dash" disabled={dashDisabled}>
                      DASH
                      {dashDisabled ? " (unavailable)" : ""}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>ABR algorithm</Label>
                <Select
                  value={isAdaptive ? abrAlgorithm : undefined}
                  onValueChange={(value) =>
                    onAbrAlgorithmChange(value as AbrAlgorithm)
                  }
                  disabled={bestMode || !isAdaptive}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        !isAdaptive ? "N/A — not adaptive" : undefined
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {isAdaptive && (
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
