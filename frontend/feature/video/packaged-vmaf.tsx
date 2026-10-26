"use client";

import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VmafChart } from "@/feature/analysis/vmaf-chart";
import { formatBitrate, formatNumber, ladderLabel } from "@/lib/analysisFormat";
import { collectVmafEntries, pickPackagedWithVmaf, type FormatKey } from "@/lib/analysisTargets";
import type { AnalysisTarget } from "@/lib/videoAnalysisApi";

/** Measured quality of every packaged rung, per ladder and format, with the per-frame series. */
export function PackagedVmaf({
  targets,
  durationSec,
}: {
  targets: AnalysisTarget[];
  durationSec?: number | null;
}) {
  const packaged = pickPackagedWithVmaf(targets);
  const [ladderId, setLadderId] = useState<string | null>(null);
  const [format, setFormat] = useState<FormatKey | null>(null);
  const [rung, setRung] = useState<string | null>(null);

  const ladder = packaged.find((target) => target.id === ladderId) ?? packaged[0];
  const entries = collectVmafEntries(ladder?.series.vmafByFormat);
  const formats = Array.from(new Set(entries.map((entry) => entry.format)));
  const activeFormat = format && formats.includes(format) ? format : (formats[0] ?? "hls");
  const rungs = entries.filter((entry) => entry.format === activeFormat);
  const activeRung = rungs.find((entry) => entry.label === rung) ?? rungs[0];

  if (!ladder || entries.length === 0) {
    return (
      <EmptyState title="No packaged VMAF yet">
        Each ladder is scored as soon as it is packaged: the static one first, the derived ones
        after their encode grids.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {packaged.length > 1 && (
          <ToggleGroup
            type="single"
            value={ladder.id}
            onValueChange={(value) => value && setLadderId(value)}
          >
            {packaged.map((target) => (
              <ToggleGroupItem key={target.id} value={target.id}>
                {ladderLabel(target.ladderKind)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        {formats.length > 1 && (
          <ToggleGroup
            type="single"
            value={activeFormat}
            onValueChange={(value) => value && setFormat(value as FormatKey)}
          >
            {formats.map((item) => (
              <ToggleGroupItem key={item} value={item}>
                {item.toUpperCase()}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      <DataTable
        head={
          <tr className="border-b border-foreground/20">
            <DataHead>Rung</DataHead>
            {["Bitrate", "Mean VMAF", "Harmonic VMAF", "Min VMAF", "NEG harmonic", "CAMBI"].map(
              (header) => (
                <DataHead key={header} numeric>
                  {header}
                </DataHead>
              ),
            )}
          </tr>
        }
      >
        {rungs.map((entry) => {
          const summary = entry.data.summary;
          return (
            <DataRow key={entry.label}>
              <DataCell>{entry.label}</DataCell>
              <DataCell numeric>{formatBitrate(summary.bitrateBps)}</DataCell>
              <DataCell numeric>{formatNumber(summary.mean)}</DataCell>
              <DataCell numeric>{formatNumber(summary.harmonicMean)}</DataCell>
              <DataCell numeric>{formatNumber(summary.min)}</DataCell>
              <DataCell numeric>
                {formatNumber(entry.data.summaryByModel?.neg?.harmonicMean)}
              </DataCell>
              <DataCell numeric last>
                {formatNumber(summary.cambi)}
              </DataCell>
            </DataRow>
          );
        })}
      </DataTable>

      {activeRung && (
        <div className="space-y-3">
          <ToggleGroup
            type="single"
            value={activeRung.label}
            onValueChange={(value) => value && setRung(value)}
            aria-label="Rung"
          >
            {rungs.map((entry) => (
              <ToggleGroupItem key={entry.label} value={entry.label}>
                {entry.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <VmafChart
            data={activeRung.data}
            label={activeRung.label}
            format={activeFormat}
            durationSec={durationSec}
          />
        </div>
      )}
    </div>
  );
}
