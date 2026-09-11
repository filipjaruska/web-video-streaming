"use client";

import * as React from "react";
import type {
  DerivedLadderDocument,
  DerivedLadderVariant,
  LadderSensitivityEntry,
} from "@/lib/videoAnalysisApi";
import {
  formatBitrate,
  formatNumber,
  formatResolution,
} from "@/lib/analysisFormat";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataCell, DataRow, DataTable } from "@/components/ui/data-table";
import { ExportCsvButton } from "@/components/export-csv-button";
import { slugFilename } from "@/lib/csvExport";

/**
 * Reads `"1080p>720p"` into its two rung labels — the resolution winning above the crossover,
 * then the one below it.
 */
function splitCrossoverKey(key: string): [string, string] {
  const [from, to] = key.split(">");
  return [from ?? key, to ?? ""];
}

type RungFlag = {
  label: string;
  title: string;
  variant: "outline" | "secondary" | "destructive";
};

/** Why a rung sits where it does, as short tags. */
function rungFlags(variant: DerivedLadderVariant): RungFlag[] {
  const flags: RungFlag[] = [];

  if (variant.capped) {
    flags.push({
      label: "capped",
      title: `Held below the crossover at ${formatBitrate(variant.capBps)}: above it the next resolution up reaches more quality for the same bits.`,
      variant: "outline",
    });
  }

  if (variant.atGridBoundary) {
    flags.push({
      label: "grid edge",
      title:
        "On the grid's lowest CRF with the hull still steeper than λ — the tangent point lies past the sampled range, so the grid, not the content, set this rung.",
      variant: "secondary",
    });
  }

  if (variant.fallback) {
    flags.push({
      label: "fallback",
      title: "No usable grid sample at this resolution; the static ladder's rung was kept.",
      variant: "destructive",
    });
  }

  if (variant.onEnvelope === false) {
    flags.push({
      label: "off envelope",
      title: `Another resolution gives ${formatNumber(variant.hullDeficit)} more VMAF at this bitrate.`,
      variant: "destructive",
    });
  }

  return flags;
}

/**
 * One derived ladder's operating points. Renders nothing when that ladder was not produced.
 *
 * Alongside each rung: the hull slope, why the rung sits where it does (capped by a crossover, on
 * the grid's edge, a fallback), the resolution crossovers, and what the derivation dropped or
 * flagged. All of it is computed by the pipeline; the crossover is the whole reason a rung sits
 * where it does, and the flags are what separate a content-driven rung from a grid artefact.
 */
export function DerivedLadderTable({
  ladder,
  caption,
  sensitivity,
}: {
  ladder?: DerivedLadderDocument | null;
  caption: string;
  /** The same ladder re-derived under other CAMBI weights — animation ladder only. */
  sensitivity?: LadderSensitivityEntry[] | null;
}) {
  const exportRows = React.useMemo(
    () =>
      (ladder?.variants ?? []).map((variant) => [
        variant.label,
        variant.resolution,
        variant.bitrate,
        variant.bitrateBps,
        variant.crf ?? "",
        variant.predictedVmaf ?? "",
        variant.predictedVmafHarmonic ?? "",
        variant.predictedVmafMin ?? "",
        variant.hullSlope ?? "",
        variant.onEnvelope ?? "",
        variant.hullDeficit ?? "",
        variant.capped ?? "",
        variant.capBps ?? "",
        variant.atGridBoundary ?? "",
        variant.fallback ?? "",
      ]),
    [ladder],
  );

  if (!ladder || ladder.variants.length === 0) {
    return null;
  }

  const crossovers = ladder.crossovers?.length
    ? ladder.crossovers.map((crossover) => ({
        key: crossover.key,
        bps: crossover.bitrateBps,
        extrapolated: crossover.extrapolated,
      }))
    : Object.entries(ladder.crossoverBps ?? {}).map(([key, bps]) => ({
        key,
        bps,
        extrapolated: false,
      }));

  const dropped = Object.entries(ladder.dropped ?? {});
  const warnings = ladder.warnings ?? [];

  const notes: string[] = [];
  if (ladder.lambda != null) {
    notes.push(
      `Shared hull slope λ = ${ladder.lambda.toFixed(2)} VMAF per bitrate doubling — every rung is taken at this same trade-off, which is what makes the ladder content-adaptive rather than a fixed target.`,
    );
  }
  if (ladder.qualityFloor != null) {
    notes.push(
      `Grid points below harmonic VMAF ${formatNumber(ladder.qualityFloor)} are left out of the hulls: down there the harmonic mean measures clipped frames, not rate.`,
    );
  }
  if (ladder.cambiPenaltyWeight) {
    notes.push(
      `Rungs are chosen on harmonic VMAF − ${formatNumber(ladder.cambiPenaltyWeight)} × CAMBI, so banding counts against a rung.`,
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">
              Derived ladder ({ladder.name})
            </CardTitle>
            <CardDescription>
              {caption}
              {notes.length > 0 ? ` ${notes.join(" ")}` : ""}
            </CardDescription>
          </div>
          <ExportCsvButton
            filename={slugFilename(["derived-ladder", ladder.name])}
            headers={[
              "rung",
              "resolution",
              "bitrate",
              "bitrate_bps",
              "crf",
              "predicted_vmaf",
              "predicted_vmaf_harmonic",
              "predicted_vmaf_min",
              "hull_slope",
              "on_envelope",
              "hull_deficit",
              "capped",
              "cap_bps",
              "at_grid_boundary",
              "fallback",
            ]}
            rows={exportRows}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DataTable
          headers={[
            "Rung",
            "Resolution",
            "Bitrate",
            "CRF",
            "Pred. VMAF",
            "Pred. harm. VMAF",
            "Hull slope",
            "Notes",
          ]}
        >
          {ladder.variants.map((variant) => {
            const flags = rungFlags(variant);
            return (
              <DataRow key={variant.label}>
                <DataCell>{variant.label}</DataCell>
                <DataCell>{formatResolution(variant.resolution)}</DataCell>
                <DataCell>{variant.bitrate}</DataCell>
                <DataCell>{variant.crf ?? "—"}</DataCell>
                <DataCell>{formatNumber(variant.predictedVmaf)}</DataCell>
                <DataCell>{formatNumber(variant.predictedVmafHarmonic)}</DataCell>
                <DataCell title="Local slope of this resolution's hull at the selected point, in VMAF per doubling of bitrate.">
                  {formatNumber(variant.hullSlope)}
                </DataCell>
                <DataCell last>
                  {flags.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {flags.map((flag) => (
                        <Badge
                          key={flag.label}
                          variant={flag.variant}
                          className="text-[10px]"
                          title={flag.title}
                        >
                          {flag.label}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    "—"
                  )}
                </DataCell>
              </DataRow>
            );
          })}
        </DataTable>

        {crossovers.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Resolution crossovers</h4>
            <p className="text-xs text-muted-foreground">
              The bitrate at which the envelope hands over from one resolution to the next. Below
              its crossover a resolution is simply the wrong choice — a lower one reaches more
              quality for the same bits — so each rung is capped at the crossover above it.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {crossovers.map(({ key, bps, extrapolated }) => {
                const [from, to] = splitCrossoverKey(key);
                return (
                  <Badge
                    key={key}
                    variant="outline"
                    className="font-mono text-xs"
                    title={
                      extrapolated
                        ? "Lies past the lower resolution's last grid sample, so that curve is extended flat to reach it."
                        : undefined
                    }
                  >
                    {from} → {to} @ {formatBitrate(bps)}
                    {extrapolated ? " (extrapolated)" : ""}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {(dropped.length > 0 || warnings.length > 0) && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Derivation notes</h4>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {dropped.map(([label, reason]) => (
                <li key={`dropped-${label}`}>
                  <span className="font-medium text-foreground">{label} dropped</span> — {reason}
                </li>
              ))}
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {sensitivity && sensitivity.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">CAMBI weight sensitivity</h4>
            <p className="text-xs text-muted-foreground">
              The same grid re-derived under other banding penalties, without encoding anything
              again. Rungs that move with the weight are the ones the penalty decides; rungs that
              stay put are decided by VMAF alone.
            </p>
            <DataTable headers={["CAMBI weight", "λ", "Rungs"]}>
              {sensitivity.map((entry) => (
                <DataRow key={entry.weight}>
                  <DataCell>
                    {formatNumber(entry.weight)}
                    {entry.weight === ladder.cambiPenaltyWeight ? " (used)" : ""}
                  </DataCell>
                  <DataCell>{formatNumber(entry.lambda)}</DataCell>
                  <DataCell last>
                    {entry.error ??
                      entry.variants
                        .map((variant) => `${variant.label} ${formatBitrate(variant.bitrateBps)}`)
                        .join(" · ")}
                  </DataCell>
                </DataRow>
              ))}
            </DataTable>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
