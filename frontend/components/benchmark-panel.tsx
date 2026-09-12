"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import {
  BENCHMARK_ALGORITHMS,
  BENCHMARK_PROTOCOLS,
  BENCHMARK_REPETITIONS,
  algorithmLabel,
  buildMatrix,
  describeCell,
  describeCellFull,
} from "@/lib/benchmark/matrix";
import { ladderLabel } from "@/lib/analysisFormat";
import {
  describeResolutionShare,
  encodeResolutionShare,
  meanResolutionShare,
  summarize,
} from "@/lib/benchmark/metrics";
import {
  NETWORK_PROFILE_CSV_IDS,
  NETWORK_PROFILE_LABELS,
  type BenchmarkLadder,
  type BenchmarkRunResult,
  type BenchmarkSelection,
  type NetworkProfile,
} from "@/lib/benchmark/types";
import type { AbrAlgorithm } from "@/types/streaming";
import type { BenchmarkProgress } from "@/hooks/useBenchmarkRunner";

interface BenchmarkPanelProps {
  progress: BenchmarkProgress;
  results: BenchmarkRunResult[];
  /** The clip's packaged ladders that a sweep can play. */
  ladders: BenchmarkLadder[];
  onStart: (profile: NetworkProfile, selection: BenchmarkSelection) => void;
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
    const of = (pick: (run: BenchmarkRunResult) => number) => summarize(group.runs.map(pick));
    const vmafValues = group.runs
      .map((run) => run.metrics.timeWeightedVmaf)
      .filter((value): value is number => value !== null);
    const topValues = group.runs
      .map((run) => run.metrics.topRungShare)
      .filter((value): value is number => value !== null);

    return {
      key,
      profile: group.profile,
      ladderKind: group.ladderKind,
      label: group.label,
      runs: group.runs.length,
      startup: summarize(
        group.runs
          .map((run) => run.metrics.startupMs)
          .filter((value): value is number => value !== null),
      ),
      session: of((run) => run.metrics.sessionMs),
      buffering: of((run) => run.metrics.bufferingRatio),
      avgBuffer: of((run) => run.metrics.avgBufferSec),
      switches: of((run) => run.metrics.qualitySwitches),
      bitrate: of((run) => run.metrics.timeWeightedBitrateBps),
      throughput: of((run) => run.metrics.avgThroughputBps),
      dropped: of((run) => run.metrics.droppedFrameRatio),
      vmaf: vmafValues.length > 0 ? summarize(vmafValues) : null,
      top: topValues.length > 0 ? summarize(topValues) : null,
      mix: meanResolutionShare(group.runs.map((run) => run.metrics.resolutionShare)),
    };
  });

  return { rows, failures };
}

function toggled<T>(set: ReadonlySet<T>, value: T, on: boolean): Set<T> {
  const next = new Set(set);
  if (on) {
    next.add(value);
  } else {
    next.delete(value);
  }

  return next;
}

function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs has-disabled:cursor-not-allowed has-disabled:opacity-60">
      <input
        type="checkbox"
        className="size-3.5 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function CheckGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">{children}</div>
    </div>
  );
}

const mbps = (bps: number) => `${(bps / 1_000_000).toFixed(2)} Mb/s`;

export function BenchmarkPanel({
  progress,
  results,
  ladders,
  onStart,
  onCancel,
  onMarkTransition,
  disabled,
}: BenchmarkPanelProps) {
  const [profile, setProfile] = useState<NetworkProfile>("standard");
  // Ladders are kept as exclusions so a ladder that loads after the panel mounts starts selected.
  const [excludedLadders, setExcludedLadders] = useState<ReadonlySet<string>>(() => new Set());
  const [protocols, setProtocols] = useState<ReadonlySet<"hls" | "dash">>(
    () => new Set(BENCHMARK_PROTOCOLS),
  );
  const [algorithms, setAlgorithms] = useState<ReadonlySet<AbrAlgorithm>>(
    () => new Set(BENCHMARK_ALGORITHMS),
  );
  const [includeSource, setIncludeSource] = useState(true);

  const selection = useMemo<BenchmarkSelection>(
    () => ({
      ladders: ladders.filter((ladder) => !excludedLadders.has(ladder.transcodeId)),
      protocols: BENCHMARK_PROTOCOLS.filter((protocol) => protocols.has(protocol)),
      algorithms: BENCHMARK_ALGORITHMS.filter((algorithm) => algorithms.has(algorithm)),
      includeSource,
    }),
    [ladders, excludedLadders, protocols, algorithms, includeSource],
  );
  const cellCount = useMemo(() => buildMatrix(selection).length, [selection]);

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
        Number(result.metrics.sessionMs.toFixed(0)),
        Number(result.metrics.bufferingRatio.toFixed(6)),
        result.metrics.rebufferCount,
        Number(result.metrics.rebufferMs.toFixed(0)),
        Number(result.metrics.avgBufferSec.toFixed(2)),
        result.metrics.qualitySwitches,
        result.metrics.oscillations,
        Number(result.metrics.timeWeightedBitrateBps.toFixed(0)),
        Number(result.metrics.avgThroughputBps.toFixed(0)),
        Number(result.metrics.droppedFrameRatio.toFixed(6)),
        result.metrics.topRungShare != null ? Number(result.metrics.topRungShare.toFixed(4)) : "",
        result.metrics.timeWeightedVmaf != null ? Number(result.metrics.timeWeightedVmaf.toFixed(3)) : "",
        encodeResolutionShare(result.metrics.resolutionShare),
        result.metrics.recoveryMs ?? "",
        result.failed ? result.errorMessage ?? "failed" : "",
      ]),
    [results],
  );

  const locked = progress.running;

  return (
    <Card>
      <CardHeader className="border-b py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Playback benchmark</CardTitle>
            <CardDescription>
              Plays every chosen protocol and ABR rule against every chosen ladder, three
              times each, and records startup, session time, buffering, switching and which
              resolution was on screen for how much of the clip — weighted by each rung&apos;s
              measured VMAF into the quality actually delivered. Every run requests its files
              under a fresh URL, so nothing is served from the browser cache. Set the network
              in clumsy first — the page cannot shape the link, so the profile below is
              recorded as a label; the measured throughput column shows what the link really
              delivered.
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
                "session_ms",
                "buffering_ratio",
                "rebuffer_count",
                "rebuffer_ms",
                "avg_buffer_sec",
                "quality_switches",
                "oscillations",
                "time_weighted_bitrate_bps",
                "avg_throughput_bps",
                "dropped_frame_ratio",
                "top_rung_share",
                "time_weighted_vmaf",
                "resolution_share",
                "recovery_ms",
                "error",
              ]}
              rows={exportRows}
            />
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        <div className="grid gap-4 rounded-md border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <CheckGroup label="Ladders">
            {ladders.length === 0 ? (
              <span className="text-xs text-muted-foreground">No packaged ladder yet</span>
            ) : (
              ladders.map((ladder) => (
                <Check
                  key={ladder.transcodeId}
                  label={ladderLabel(ladder.ladderKind)}
                  checked={!excludedLadders.has(ladder.transcodeId)}
                  disabled={locked}
                  onChange={(on) =>
                    setExcludedLadders((current) => toggled(current, ladder.transcodeId, !on))
                  }
                />
              ))
            )}
          </CheckGroup>
          <CheckGroup label="Protocols">
            {BENCHMARK_PROTOCOLS.map((protocol) => (
              <Check
                key={protocol}
                label={protocol.toUpperCase()}
                checked={protocols.has(protocol)}
                disabled={locked}
                onChange={(on) => setProtocols((current) => toggled(current, protocol, on))}
              />
            ))}
          </CheckGroup>
          <CheckGroup label="ABR rules">
            {BENCHMARK_ALGORITHMS.map((algorithm) => (
              <Check
                key={algorithm}
                label={algorithmLabel(algorithm)}
                checked={algorithms.has(algorithm)}
                disabled={locked}
                onChange={(on) => setAlgorithms((current) => toggled(current, algorithm, on))}
              />
            ))}
          </CheckGroup>
          <CheckGroup label="Reference">
            <Check
              label="Source · HTTP Range"
              checked={includeSource}
              disabled={locked}
              onChange={setIncludeSource}
            />
          </CheckGroup>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 space-y-1.5">
            <label className="text-xs text-muted-foreground">Network profile (set in clumsy)</label>
            <Select
              value={profile}
              onValueChange={(value) => setProfile(value as NetworkProfile)}
              disabled={locked}
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
            <Button
              onClick={() => onStart(profile, selection)}
              disabled={disabled || cellCount === 0}
            >
              Run benchmark
            </Button>
          )}

          {progress.running && (
            <Button variant="outline" onClick={() => onMarkTransition(profile)}>
              Mark network change
            </Button>
          )}

          {!progress.running && (
            <span className="pb-2 text-xs text-muted-foreground">
              {cellCount} configuration{cellCount === 1 ? "" : "s"} × {BENCHMARK_REPETITIONS}{" "}
              repetitions = {cellCount * BENCHMARK_REPETITIONS} runs
            </span>
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
                  <th className="py-2 pr-3 font-medium" title="Play request to the end of the clip, stalls included">
                    Session (s)
                  </th>
                  <th className="py-2 pr-3 font-medium">Buffering ratio</th>
                  <th className="py-2 pr-3 font-medium" title="Mean forward buffer while playing">
                    Avg buffer (s)
                  </th>
                  <th className="py-2 pr-3 font-medium">Switches</th>
                  <th className="py-2 pr-3 font-medium" title="Share of played time at the ladder's top rung">
                    Top rung
                  </th>
                  <th
                    className="py-2 pr-3 font-medium"
                    title="Each played rung's measured harmonic VMAF, weighted by its share of played time"
                  >
                    Delivered VMAF
                  </th>
                  <th className="py-2 pr-3 font-medium" title="Time-weighted declared bitrate of the rungs played">
                    Avg bitrate
                  </th>
                  <th
                    className="py-2 pr-3 font-medium"
                    title="The player's own throughput estimate, averaged — what the link actually delivered"
                  >
                    Throughput
                  </th>
                  <th className="py-2 pr-3 font-medium">Dropped frames</th>
                  <th className="py-2 font-medium">Resolution mix</th>
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
                    <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                      {row.startup.mean.toFixed(0)} ± {row.startup.stdDev.toFixed(0)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                      {(row.session.mean / 1000).toFixed(1)} ± {(row.session.stdDev / 1000).toFixed(1)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                      {(row.buffering.mean * 100).toFixed(2)} % ± {(row.buffering.stdDev * 100).toFixed(2)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {row.avgBuffer.mean.toFixed(1)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                      {row.switches.mean.toFixed(1)} ± {row.switches.stdDev.toFixed(1)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {row.top ? `${(row.top.mean * 100).toFixed(0)} %` : "—"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                      {row.vmaf ? `${row.vmaf.mean.toFixed(2)} ± ${row.vmaf.stdDev.toFixed(2)}` : "—"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                      {mbps(row.bitrate.mean)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                      {row.throughput.mean > 0 ? mbps(row.throughput.mean) : "—"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {(row.dropped.mean * 100).toFixed(2)} %
                    </td>
                    <td className="py-1.5 font-mono text-xs whitespace-nowrap">
                      {describeResolutionShare(row.mix)}
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
