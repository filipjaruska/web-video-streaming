"use client";

import * as React from "react";
import type { DerivedLadderDocument } from "@/lib/videoAnalysisApi";
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
 * Reads `"1080p>720p"` into its two rung labels. The backend builds these keys in
 * `LadderDerivation.FindCrossovers`, which may emit several or none.
 */
function splitCrossoverKey(key: string): [string, string] {
  const [from, to] = key.split(">");
  return [from ?? key, to ?? ""];
}

/**
 * One derived ladder's operating points. Renders nothing when that ladder was not produced.
 *
 * Shows the hull slope and the resolution crossovers alongside each rung. Both are computed by the
 * pipeline and were previously reachable only by expanding the raw analysis tree, even though the
 * crossover is the whole reason a rung sits where it does.
 */
export function DerivedLadderTable({
  ladder,
  caption,
}: {
  ladder?: DerivedLadderDocument | null;
  caption: string;
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
      ]),
    [ladder],
  );

  if (!ladder || ladder.variants.length === 0) {
    return null;
  }

  const crossovers = Object.entries(ladder.crossoverBps ?? {});

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
              {ladder.lambda != null
                ? ` Shared hull slope λ = ${ladder.lambda.toFixed(2)} VMAF per bitrate doubling — every rung is taken at this same trade-off, which is what makes the ladder content-adaptive rather than a fixed target.`
                : ""}
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
          ]}
        >
          {ladder.variants.map((variant) => (
            <DataRow key={variant.label}>
              <DataCell>{variant.label}</DataCell>
              <DataCell>{formatResolution(variant.resolution)}</DataCell>
              <DataCell>{variant.bitrate}</DataCell>
              <DataCell>{variant.crf ?? "—"}</DataCell>
              <DataCell>{formatNumber(variant.predictedVmaf)}</DataCell>
              <DataCell>{formatNumber(variant.predictedVmafHarmonic)}</DataCell>
              <DataCell
                last
                title="Local slope of this resolution's hull at the selected point, in VMAF per doubling of bitrate."
              >
                {formatNumber(variant.hullSlope)}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>

        {crossovers.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Resolution crossovers</h4>
            <p className="text-xs text-muted-foreground">
              The bitrate at which the hull hands over from one resolution to the next. Below its
              crossover a resolution is simply the wrong choice — a lower one reaches the same
              quality for the same bits.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {crossovers.map(([key, bps]) => {
                const [from, to] = splitCrossoverKey(key);
                return (
                  <Badge key={key} variant="outline" className="font-mono text-xs">
                    {from} → {to} @ {formatBitrate(bps)}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
