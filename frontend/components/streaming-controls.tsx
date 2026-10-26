"use client";

import { memo } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ladderLabel } from "@/lib/analysisFormat";
import { getAbrLabel } from "@/lib/streamingLabels";
import type { VideoTranscodeListItem } from "@/lib/videoTranscodesApi";
import type { AbrAlgorithm, StreamingMethod } from "@/types/streaming";
import { SOURCE_RUN_ID, isSourceRun } from "@/types/streaming";

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
  /** Why Best mode chose this protocol, shown so the decision can be checked. */
  bestReason?: string;
}

function protocolLabel(method: StreamingMethod): string {
  switch (method) {
    case "source":
      return "Progressive (HTTP range)";
    case "hls":
      return "HLS";
    case "dash":
      return "DASH";
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
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
  bestReason,
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
    <section className="space-y-4 rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label htmlFor="best-mode" className="cursor-pointer">
            Best mode
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {bestMode ? "Picks the stream for this browser." : "Choose the stream yourself."}
          </p>
        </div>
        <Switch id="best-mode" checked={bestMode} onCheckedChange={onBestModeChange} />
      </div>

      {bestMode ? (
        <dl className="divide-y border-t">
          <Row label="Ladder">
            {sourceSelected
              ? "Source file"
              : selectedTranscode
                ? ladderLabel(selectedTranscode.ladderKind)
                : "…"}
          </Row>
          <Row label="Delivery">{protocolLabel(streamingMethod)}</Row>
          <Row label="ABR rule">{isAdaptive ? getAbrLabel(abrAlgorithm) : "None"}</Row>
          {bestReason && <p className="pt-2 text-xs text-muted-foreground">{bestReason}</p>}
        </dl>
      ) : (
        <div className="space-y-3 border-t pt-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Ladder</Label>
            <Select
              value={packagingRunId ?? undefined}
              onValueChange={onPackagingRunChange}
              disabled={transcodesLoading}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={transcodesLoading ? "Loading…" : "Select a ladder"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SOURCE_RUN_ID}>Source file</SelectItem>
                {succeeded.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {ladderLabel(item.ladderKind)}
                    {item.isActive ? " (active)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Delivery</Label>
            <Select
              value={streamingMethod}
              onValueChange={(value) => onStreamingMethodChange(value as StreamingMethod)}
              disabled={sourceSelected}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sourceSelected ? (
                  <SelectItem value="source">{protocolLabel("source")}</SelectItem>
                ) : (
                  <>
                    <SelectItem value="hls" disabled={hlsDisabled}>
                      HLS{hlsDisabled ? " (not packaged)" : ""}
                    </SelectItem>
                    <SelectItem value="dash" disabled={dashDisabled}>
                      DASH{dashDisabled ? " (not packaged)" : ""}
                    </SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">ABR rule</Label>
            <Select
              value={isAdaptive ? abrAlgorithm : "none"}
              onValueChange={(value) => onAbrAlgorithmChange(value as AbrAlgorithm)}
              disabled={!isAdaptive}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {isAdaptive ? (
                  (["hybrid", "throughput", "buffer", "baseline"] as const).map((algorithm) => (
                    <SelectItem key={algorithm} value={algorithm}>
                      {getAbrLabel(algorithm)}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="none">None</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </section>
  );
}

export const StreamingControls = memo(StreamingControlsComponent);
