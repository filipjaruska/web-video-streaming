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

/**
 * The bound a rung was clamped to, when its λ point fell outside its admissible interval. A rung at
 * its λ point gets no tag.
 */
function placementFlag(variant: DerivedLadderVariant): RungFlag | null {
  const lambdaPoint = formatBitrate(variant.lambdaPointBps);
  switch (variant.placement) {
    case "window":
      return {
        label: "window",
        title: `λ point at ${lambdaPoint} lies below ${formatBitrate(variant.intervalLowBps)}, where this resolution starts to be the best one — raised to that bound.`,
        variant: "outline",
      };
    case "cap":
      return {
        label: "cap",
        title: `λ point at ${lambdaPoint} lies above the crossover at ${formatBitrate(variant.intervalHighBps)}, past which the next resolution up is better — lowered to it.`,
        variant: "outline",
      };
    case "spacing":
      return {
        label: "spacing",
        title: `λ point at ${lambdaPoint} lies within ×1.5 of the rung above — lowered to ${formatBitrate(variant.intervalHighBps)}.`,
        variant: "outline",
      };
    case "floor":
      return {
        label: "floor",
        title: `λ point at ${lambdaPoint} lies below the bitrate floor — raised to ${formatBitrate(variant.intervalLowBps)}.`,
        variant: "secondary",
      };
    default:
      return null;
  }
}

/** Why a rung sits where it does, as short tags. */
function rungFlags(variant: DerivedLadderVariant): RungFlag[] {
  const flags: RungFlag[] = [];

  const placement = placementFlag(variant);
  if (placement) {
    flags.push(placement);
  }

  if (variant.atGridBoundary) {
    flags.push({
      label: "grid edge",
      title:
        "On the grid's lowest CRF with the hull still steeper than λ — the tangent point lies past the sampled range, so the grid, not the content, set this rung.",
      variant: "secondary",
    });
  }

  if (variant.interpolatedBetweenCrf) {
    const [lower, upper] = variant.interpolatedBetweenCrf;
    flags.push({
      label: "interpolated",
      title: `No grid sample at this rate: the predicted scores are read off the hull between CRF ${lower} and CRF ${upper}.`,
      variant: "outline",
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

/** Which top-rung bound, if any, moved λ off its base slope. */
function describeLambdaRule(ladder: DerivedLadderDocument): string | null {
  if (!ladder.lambdaRule || ladder.lambdaBase == null) {
    return null;
  }

  const base = formatNumber(ladder.lambdaBase);
  const range = `harmonic VMAF ${formatNumber(ladder.topRungFloor)}–${formatNumber(ladder.topRungCeiling)}`;

  switch (ladder.lambdaRule) {
    case "ceiling":
      return `λ starts at ${base}; there the top rung exceeded ${range}, so λ was raised onto the cheapest sample that still reaches the ceiling.`;
    case "floor":
      return `λ starts at ${base}; there the top rung fell short of ${range}, so λ was lowered until it clears the floor.`;
    case "reachable":
      return `λ starts at ${base}; the top resolution never reaches ${range}, so λ was lowered to its best sample.`;
    default:
      return `λ is the base slope ${base}: the top rung already lies inside ${range}.`;
  }
}

/**
 * One derived ladder's operating points. Renders nothing when that ladder was not produced.
 *
 * Alongside each rung: the hull slope, why the rung sits where it does (the bound of its interval it
 * was clamped to, the grid's edge, a fallback), the resolution crossovers, and what the derivation dropped or
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
        variant.interpolatedBetweenCrf?.join("-") ?? "",
        variant.predictedVmaf ?? "",
        variant.predictedVmafHarmonic ?? "",
        variant.predictedVmafMin ?? "",
        variant.hullSlope ?? "",
        variant.onEnvelope ?? "",
        variant.hullDeficit ?? "",
        variant.placement ?? "",
        variant.lambdaPointBps ?? "",
        variant.intervalLowBps ?? "",
        variant.intervalHighBps ?? "",
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
    const rule = describeLambdaRule(ladder);
    if (rule) {
      notes.push(rule);
    }
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
              "interpolated_between_crf",
              "predicted_vmaf",
              "predicted_vmaf_harmonic",
              "predicted_vmaf_min",
              "hull_slope",
              "on_envelope",
              "hull_deficit",
              "placement",
              "lambda_point_bps",
              "interval_low_bps",
              "interval_high_bps",
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
                <DataCell>
                  {variant.crf ??
                    (variant.interpolatedBetweenCrf
                      ? variant.interpolatedBetweenCrf.join("–")
                      : "—")}
                </DataCell>
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
              quality for the same bits — so each rung stays inside the window between the
              crossovers either side of it, and is clamped to the nearer one when its λ point falls
              outside.
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
