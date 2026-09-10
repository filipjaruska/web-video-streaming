"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ExportCsvButton } from "@/components/export-csv-button";
import { slugFilename } from "@/lib/csvExport";
import { describeCell, describeCellFull } from "@/lib/benchmark/matrix";
import { ladderLabel } from "@/lib/analysisFormat";
import { summarize } from "@/lib/benchmark/metrics";
import {
  NETWORK_PROFILE_CSV_IDS,
  NETWORK_PROFILE_LABELS,
  type BenchmarkRunResult,
  type NetworkProfile,
} from "@/lib/benchmark/types";
import type { BenchmarkProgress } from "@/hooks/useBenchmarkRunner";

interface BenchmarkPanelProps {
  progress: BenchmarkProgress;
  results: BenchmarkRunResult[];
  onStart: (profile: NetworkProfile) => void;
  onCancel: () => void;
  onMarkTransition: (profile: NetworkProfile) => void;
  disabled?: boolean;
}

const PROFILES: NetworkProfile[] = ["standard", "fourG", "threeG", "variable"];

/**
 * One row per measured configuration, collapsing its repetitions into a mean and spread.
 *
 * Grouped on network profile and ladder as well as protocol and algorithm — those four together
 * are what identifies a cell. Both are also shown as columns, so the split is visible rather than
 * merely correct.
 */
function aggregate(results: BenchmarkRunResult[]) {
  const groups = new Map<
    string,
    { profile: NetworkProfile; ladderKind: string; label: string; runs: BenchmarkRunResult[] }
  >();

  const failures: BenchmarkRunResult[] = [];

  for (const result of results) {
    if (result.failed) {
      failures.push(result);
      continue;
    }

    const key = describeCellFull(result.cell, result.networkProfile);
    const existing = groups.get(key);
    if (existing) {
      existing.runs.push(result);
      continue;
    }

    groups.set(key, {
      profile: result.networkProfile,
      ladderKind: result.cell.ladderKind,
      label: describeCell(result.cell),
      runs: [result],
    });
  }

  const rows = Array.from(groups.entries()).map(([key, group]) => {
    const startup = summarize(
      group.runs
        .map((run) => run.metrics.startupMs)
        .filter((value): value is number => value !== null),
    );
    const buffering = summarize(group.runs.map((run) => run.metrics.bufferingRatio));
    const switches = summarize(group.runs.map((run) => run.metrics.qualitySwitches));

    return {
      key,
      profile: group.profile,
      ladderKind: group.ladderKind,
      label: group.label,
      runs: group.runs.length,
      startup,
      buffering,
      switches,
    };
  });

  return { rows, failures };
}

export function BenchmarkPanel({
  progress,
  results,
  onStart,
  onCancel,
  onMarkTransition,
  disabled,
}: BenchmarkPanelProps) {
  const [profile, setProfile] = useState<NetworkProfile>("standard");
  const { rows, failures } = useMemo(() => aggregate(results), [results]);

  const exportRows = useMemo(
    () =>
      results.map((result) => [
        NETWORK_PROFILE_CSV_IDS[result.networkProfile],
        result.cell.ladderKind,
        result.cell.protocol,
        result.cell.algorithm,
        result.repetition,
        result.metrics.startupMs ?? "",
        Number(result.metrics.bufferingRatio.toFixed(6)),
        result.metrics.rebufferCount,
        Number(result.metrics.rebufferMs.toFixed(0)),
        result.metrics.qualitySwitches,
        result.metrics.oscillations,
        Number(result.metrics.timeWeightedBitrateBps.toFixed(0)),
        result.metrics.recoveryMs ?? "",
        result.failed ? result.errorMessage ?? "failed" : "",
      ]),
    [results],
  );

  return (
    <Card>
      <CardHeader className="border-b py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Playback benchmark</CardTitle>
            <CardDescription>
              Plays every protocol and ABR rule against the selected ladder, three times
              each, and records startup time, buffering ratio and switching behaviour.
              Set the network in clumsy first — the page cannot shape the link, so the
              profile below is recorded as a label.
            </CardDescription>
          </div>
          {results.length > 0 && (
            <ExportCsvButton
              filename={slugFilename(["benchmark", profile])}
              headers={[
                "network_profile",
                "ladder",
                "protocol",
                "algorithm",
                "repetition",
                "startup_ms",
                "buffering_ratio",
                "rebuffer_count",
                "rebuffer_ms",
                "quality_switches",
                "oscillations",
                "time_weighted_bitrate_bps",
                "recovery_ms",
                "error",
              ]}
              rows={exportRows}
            />
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 space-y-1.5">
            <label className="text-xs text-muted-foreground">Network profile (set in clumsy)</label>
            <Select
              value={profile}
              onValueChange={(value) => setProfile(value as NetworkProfile)}
              disabled={progress.running}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROFILES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {NETWORK_PROFILE_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {progress.running ? (
            <Button variant="destructive" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button onClick={() => onStart(profile)} disabled={disabled}>
              Run benchmark
            </Button>
          )}

          {progress.running && (
            <Button variant="outline" onClick={() => onMarkTransition(profile)}>
              Mark network change
            </Button>
          )}
        </div>

        {progress.running && (
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                Cell {progress.cellIndex}/{progress.cellCount}
              </Badge>
              <span className="font-mono text-xs">{progress.cellLabel}</span>
              <span className="text-muted-foreground text-xs">
                repetition {progress.repetition}/{progress.repetitions}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave this tab focused. Browsers throttle timers and media in background
              tabs, which would be recorded as rebuffering that never happened.
            </p>
          </div>
        )}

        {failures.length > 0 && (
          <div className="space-y-2">
            <Badge variant="destructive">
              {failures.length} run{failures.length === 1 ? "" : "s"} failed — excluded from
              the means below
            </Badge>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Show failures</summary>
              <ul className="mt-1.5 space-y-1 pl-4">
                {failures.map((failure, index) => (
                  <li key={`${describeCellFull(failure.cell, failure.networkProfile)}:${failure.repetition}:${index}`}>
                    <span className="font-mono">
                      {NETWORK_PROFILE_LABELS[failure.networkProfile]} ·{" "}
                      {ladderLabel(failure.cell.ladderKind)} · {describeCell(failure.cell)} · rep{" "}
                      {failure.repetition}
                    </span>{" "}
                    — {failure.errorMessage ?? "failed"}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Network</th>
                  <th className="py-2 pr-3 font-medium">Ladder</th>
                  <th className="py-2 pr-3 font-medium">Configuration</th>
                  <th className="py-2 pr-3 font-medium">Runs</th>
                  <th className="py-2 pr-3 font-medium">Startup (ms)</th>
                  <th className="py-2 pr-3 font-medium">Buffering ratio</th>
                  <th className="py-2 font-medium">Switches</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-border/50 last:border-b-0">
                    <td className="py-1.5 pr-3 text-xs">
                      {NETWORK_PROFILE_LABELS[row.profile]}
                    </td>
                    <td className="py-1.5 pr-3 text-xs">{ladderLabel(row.ladderKind)}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{row.label}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{row.runs}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {row.startup.mean.toFixed(0)} ± {row.startup.stdDev.toFixed(0)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {(row.buffering.mean * 100).toFixed(2)} % ± {(row.buffering.stdDev * 100).toFixed(2)}
                    </td>
                    <td className="py-1.5 font-mono text-xs">
                      {row.switches.mean.toFixed(1)} ± {row.switches.stdDev.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
