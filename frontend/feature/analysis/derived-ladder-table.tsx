"use client";

import * as React from "react";
import type {
  DerivedLadderDocument,
  DerivedLadderVariant,
  LadderComparisonPoint,
  LadderSensitivityEntry,
} from "@/lib/videoAnalysisApi";
import { formatBitrate, formatNumber, formatResolution } from "@/lib/analysisFormat";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Figure } from "@/components/figure";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import { Hint } from "@/components/ui/tooltip";
import { slugFilename } from "@/lib/csvExport";
import { cn } from "@/lib/utils";

/**
 * Reads `"1080p>720p"` into its two rung labels: the resolution winning above the crossover,
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
        title: `λ point at ${lambdaPoint} lies below ${formatBitrate(variant.intervalLowBps)}, where this resolution starts to be the best one. Raised to that bound.`,
        variant: "outline",
      };
    case "cap":
      return {
        label: "cap",
        title: `λ point at ${lambdaPoint} lies above the crossover at ${formatBitrate(variant.intervalHighBps)}, past which the next resolution up is better. Lowered to it.`,
        variant: "outline",
      };
    case "spacing":
      return {
        label: "spacing",
        title: `λ point at ${lambdaPoint} lies within ×1.5 of the rung above. Lowered to ${formatBitrate(variant.intervalHighBps)}.`,
        variant: "outline",
      };
    case "floor":
      return {
        label: "floor",
        title: `λ point at ${lambdaPoint} lies below the bitrate floor. Raised to ${formatBitrate(variant.intervalLowBps)}.`,
        variant: "secondary",
      };
    case "gap":
      return {
        label: "gap",
        title: `Inserted at the geometric mean of a gap wider than ×2 between ${formatBitrate(variant.intervalHighBps)} and ${formatBitrate(variant.intervalLowBps)}: a resolution the ladder did not have, the one that predicts best there.`,
        variant: "outline",
      };
    case "top":
      return {
        label: "top",
        title: `This resolution never wins on the envelope, but every ladder keeps the highest resolution: it takes the top rung's slot at that rung's ${formatBitrate(variant.intervalLowBps)}, raised along its own curve only as far as decision quality 88 and the CAMBI limit need. The resolution it displaced can return lower down to fill a gap.`,
        variant: "secondary",
      };
    case "cambi":
      return {
        label: "cambi",
        title: `λ point at ${lambdaPoint} predicts too much banding. Raised to ${formatBitrate(variant.intervalLowBps)}, the lowest rate whose predicted CAMBI stays within the limit.`,
        variant: "secondary",
      };
    default:
      return null;
  }
}

/** Why a rung sits where it does, as short tags. */
function rungFlags(variant: DerivedLadderVariant): RungFlag[] {
  const flags: RungFlag[] = [];

  if (variant.setting) {
    flags.push({
      label: variant.setting,
      title:
        variant.setting === "tuned"
          ? "Encoded with the animation tune: its own curve gives the higher decision quality at this rate."
          : "Encoded with the default settings: their own curve gives the higher decision quality at this rate.",
      variant: "secondary",
    });
  }

  const placement = placementFlag(variant);
  if (placement) {
    flags.push(placement);
  }

  if (variant.atGridBoundary) {
    flags.push({
      label: "grid edge",
      title:
        "On the grid's lowest CRF with the hull still steeper than λ: the tangent point lies past the sampled range, so the grid set this rung, not the content.",
      variant: "secondary",
    });
  }

  if (variant.cambiLimit === "cambi-unmet") {
    flags.push({
      label: "cambi-unmet",
      title:
        "No rate inside this rung's interval keeps its predicted CAMBI within the limit, so the other rules alone placed it.",
      variant: "destructive",
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
  title,
  achieved,
  sensitivity,
}: {
  ladder?: DerivedLadderDocument | null;
  title: string;
  /** The packaged rungs as measured, matched to the derived ones by label. */
  achieved?: LadderComparisonPoint[];
  /** The same ladder re-derived under other CAMBI weights; animation-optimised ladder only. */
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
        variant.predictedCambi ?? "",
        variant.setting ?? "",
        variant.cambiLimit ?? "",
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
      `Every rung is taken at the same hull slope, λ = ${ladder.lambda.toFixed(2)} VMAF per doubling of bitrate.`,
    );
    const rule = describeLambdaRule(ladder);
    if (rule) {
      notes.push(rule);
    }
  }
  if (ladder.qualityFloor != null) {
    notes.push(
      `Grid points below harmonic VMAF ${formatNumber(ladder.qualityFloor)} are left out of the hulls.`,
    );
  }
  if (ladder.cambiPenaltyWeight) {
    notes.push(
      `Rungs are chosen on harmonic VMAF − ${formatNumber(ladder.cambiPenaltyWeight)} × CAMBI.`,
    );
  }
  if (ladder.cambiLimit) {
    notes.push(
      `${ladder.cambiLimit === "TopRung" ? "The top rung is" : "Every rung at 720p and above is"} held to predicted CAMBI ≤ ${formatNumber(ladder.maxPredictedCambi)}, which takes precedence over the 95 ceiling.`,
    );
  }

  const achievedByLabel = new Map((achieved ?? []).map((point) => [point.label, point]));
  const hasAchieved = achievedByLabel.size > 0;

  return (
    <Figure
      title={title}
      note={notes.length > 0 ? notes.join(" ") : undefined}
      actions={
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
            "predicted_cambi",
            "setting",
            "cambi_limit",
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
      }
    >
      <DataTable
        head={
          <>
            <tr>
              <DataHead rowSpan={2}>Rung</DataHead>
              <DataHead rowSpan={2}>Resolution</DataHead>
              <DataHead rowSpan={2} numeric>
                CRF
              </DataHead>
              <DataHead colSpan={3} className="border-b text-center">
                Predicted
              </DataHead>
              {hasAchieved && (
                <DataHead colSpan={2} className="border-b text-center">
                  Achieved
                </DataHead>
              )}
              <DataHead rowSpan={2} numeric>
                Hull slope
              </DataHead>
              <DataHead rowSpan={2}>Placement</DataHead>
            </tr>
            <tr className="border-b border-foreground/20">
              <DataHead numeric>Bitrate</DataHead>
              <DataHead numeric>Harmonic VMAF</DataHead>
              <DataHead numeric>CAMBI</DataHead>
              {hasAchieved && (
                <>
                  <DataHead numeric>Bitrate</DataHead>
                  <DataHead numeric>Harmonic VMAF</DataHead>
                </>
              )}
            </tr>
          </>
        }
      >
        {ladder.variants.map((variant) => {
          const flags = rungFlags(variant);
          const measured = achievedByLabel.get(variant.label);
          return (
            <DataRow key={variant.label}>
              <DataCell>{variant.label}</DataCell>
              <DataCell>{formatResolution(variant.resolution)}</DataCell>
              <DataCell numeric>
                {variant.crf ??
                  (variant.interpolatedBetweenCrf ? variant.interpolatedBetweenCrf.join("–") : "—")}
              </DataCell>
              <DataCell numeric>{formatBitrate(variant.bitrateBps)}</DataCell>
              <DataCell numeric>
                {formatNumber(variant.predictedVmafHarmonic ?? variant.predictedVmaf)}
              </DataCell>
              <DataCell numeric>{formatNumber(variant.predictedCambi)}</DataCell>
              {hasAchieved && (
                <>
                  <DataCell numeric>{formatBitrate(measured?.bitrateBps)}</DataCell>
                  <DataCell numeric>{formatNumber(measured?.vmafHarmonicMean)}</DataCell>
                </>
              )}
              <DataCell
                numeric
                title="Slope of this resolution's hull at the rung, VMAF per doubling of bitrate."
              >
                {formatNumber(variant.hullSlope)}
              </DataCell>
              <DataCell mono={false} last>
                {flags.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {flags.map((flag) => (
                      <Hint key={flag.label} content={flag.title}>
                        <span
                          tabIndex={0}
                          className={cn(
                            "cursor-help rounded-sm border px-1.5 py-px text-[11px] whitespace-nowrap",
                            flag.variant === "destructive"
                              ? "border-destructive/40 text-destructive"
                              : flag.variant === "secondary"
                                ? "border-transparent bg-muted"
                                : "text-muted-foreground",
                          )}
                        >
                          {flag.label}
                        </span>
                      </Hint>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">λ point</span>
                )}
              </DataCell>
            </DataRow>
          );
        })}
      </DataTable>

      {crossovers.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Crossovers: </span>
          {crossovers.map(({ key, bps, extrapolated }, index) => {
            const [from, to] = splitCrossoverKey(key);
            return (
              <span key={key} className="whitespace-nowrap">
                {index > 0 && " · "}
                {from} → {to} at {formatBitrate(bps)}
                {extrapolated ? " (extrapolated)" : ""}
              </span>
            );
          })}
          . Each rung stays between the crossovers either side of it.
        </p>
      )}

      {(dropped.length > 0 || warnings.length > 0) && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {dropped.map(([label, reason]) => (
            <li key={`dropped-${label}`}>
              <span className="font-medium text-foreground">{label} dropped:</span> {reason}
            </li>
          ))}
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {sensitivity && sensitivity.length > 0 && (
        <div className="space-y-2 pt-2">
          <h4 className="text-sm font-medium">CAMBI weight sensitivity</h4>
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
          <p className="text-xs text-muted-foreground">
            The same grids re-derived under other banding penalties, nothing re-encoded. Rungs that
            move with the weight are the ones the penalty decides.
          </p>
        </div>
      )}
    </Figure>
  );
}
