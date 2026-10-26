"use client";

import { useMemo, useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useActionAuth } from "@/components/action-auth-provider";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Figure } from "@/components/figure";
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
  NETWORK_PROFILE_RATE_BPS,
  NETWORK_PROFILE_SHORT,
  exceedsProfileRate,
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
  /** Why the last sweep stopped saving, if it did. */
  saveError?: string | null;
  /** The video's packaged ladders that a sweep can play. */
  ladders: BenchmarkLadder[];
  /** One profile for a custom run; all four for Run all. */
  onStart: (profiles: NetworkProfile[], selection: BenchmarkSelection) => void;
  onCancel: () => void;
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
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
    </label>
  );
}

function CheckGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

const mbps = (bps: number) => `${(bps / 1_000_000).toFixed(2)} Mb/s`;

/** Every cell the server can play: all ladders, both protocols, all rules, plus the source file. */
function fullSelection(ladders: BenchmarkLadder[]): BenchmarkSelection {
  return {
    ladders,
    protocols: [...BENCHMARK_PROTOCOLS],
    algorithms: [...BENCHMARK_ALGORITHMS],
    includeSource: true,
  };
}

/**
 * The benchmark controls: what to play, under which network, and Run all. Narrow enough to sit
 * beside the player; this session's results are shown by `BenchmarkSessionResults`.
 */
export function BenchmarkPanel({
  progress,
  results,
  saveError,
  ladders,
  onStart,
  onCancel,
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
  const [customOpen, setCustomOpen] = useState(false);

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
  const allRuns =
    buildMatrix(fullSelection(ladders)).length * BENCHMARK_REPETITIONS * PROFILES.length;

  // A sweep writes results to the server and occupies the player for minutes, so it is gated like
  // the other mutating actions rather than left open to any visitor.
  const { requireAuth } = useActionAuth();

  async function handleStart() {
    if (await requireAuth()) {
      onStart([profile], selection);
    }
  }

  async function handleRunAll() {
    if (await requireAuth()) {
      onStart(PROFILES, fullSelection(ladders));
    }
  }

  const { rows, failures } = useMemo(() => aggregate(results), [results]);
  // Checked after every run, so a link that is not shaped as declared shows up on the first one.
  const mismatched = rows.filter((row) => exceedsProfileRate(row.profile, row.throughput.mean));

  const runsDone = progress.running
    ? ((progress.profileIndex - 1) * progress.cellCount + Math.max(0, progress.cellIndex - 1)) *
        progress.repetitions +
      Math.max(0, progress.repetition - 1)
    : 0;
  const runsTotal = progress.profileCount * progress.cellCount * progress.repetitions;

  return (
    <section className="space-y-5 rounded-md border p-4">
      <div className="space-y-1">
        <h2 className="font-semibold">Playback benchmark</h2>
        <p className="text-xs text-muted-foreground">
          Each combination plays three times under the chosen network and is saved. Files are
          requested under fresh URLs, and the server shapes every request.
        </p>
      </div>

      {progress.running ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge status="running" />
            <span className="font-mono text-xs tabular text-muted-foreground">
              {runsDone} of {runsTotal}
            </span>
          </div>
          <Progress value={runsTotal > 0 ? (runsDone / runsTotal) * 100 : 0} className="h-1.5" />
          <dl className="space-y-1 text-xs">
            {progress.profile && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Network</dt>
                <dd>
                  {NETWORK_PROFILE_SHORT[progress.profile]}
                  {progress.profileCount > 1 &&
                    ` (${progress.profileIndex} of ${progress.profileCount})`}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Now playing</dt>
              <dd className="text-right font-mono">{progress.cellLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Repetition</dt>
              <dd>
                {progress.repetition} of {progress.repetitions}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Keep this tab in front. Browsers throttle background tabs, which would be recorded as
            stalls that never happened.
          </p>
          <Button
            variant="destructive"
            className="w-full"
            onClick={async () => {
              if (await requireAuth()) {
                onCancel();
              }
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Button
              className="w-full"
              onClick={() => void handleRunAll()}
              disabled={disabled || ladders.length === 0}
            >
              Run all
            </Button>
            <p className="text-xs text-muted-foreground">
              Every ladder, protocol and rule plus the source file, under all four networks:{" "}
              {allRuns} runs.
            </p>
          </div>

          <details
            className="group border-t pt-4"
            open={customOpen}
            onToggle={(event) => setCustomOpen(event.currentTarget.open)}
          >
            <summary
              className="cursor-pointer text-sm font-medium select-none"
              onClick={async (event) => {
                // Opening the selection is gated like running it; closing never is.
                if (customOpen) {
                  return;
                }
                event.preventDefault();
                if (await requireAuth()) {
                  setCustomOpen(true);
                }
              }}
            >
              Choose what to run
            </summary>
            <div className="mt-4 space-y-4">
              <CheckGroup label="Ladders">
                {ladders.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No packaged ladder yet</span>
                ) : (
                  ladders.map((ladder) => (
                    <Check
                      key={ladder.transcodeId}
                      label={ladderLabel(ladder.ladderKind)}
                      checked={!excludedLadders.has(ladder.transcodeId)}
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
                    onChange={(on) => setAlgorithms((current) => toggled(current, algorithm, on))}
                  />
                ))}
              </CheckGroup>
              <CheckGroup label="Reference">
                <Check
                  label="Source file over HTTP range"
                  checked={includeSource}
                  onChange={setIncludeSource}
                />
              </CheckGroup>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Network profile</Label>
                <Select
                  value={profile}
                  onValueChange={(value) => setProfile(value as NetworkProfile)}
                >
                  <SelectTrigger className="w-full">
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
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void handleStart()}
                disabled={disabled || cellCount === 0}
              >
                Run {cellCount * BENCHMARK_REPETITIONS} runs
              </Button>
            </div>
          </details>
        </>
      )}

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      {mismatched.length > 0 && (
        <div className="space-y-1.5 rounded-sm border border-warning/40 bg-warning/10 p-3 text-xs">
          <p className="font-medium">
            The link was faster than the profile these runs are saved under, so the shaping did not
            apply. Check that the backend is deployed with network shaping.
          </p>
          <ul className="space-y-0.5 pl-4 font-mono">
            {mismatched.map((row) => (
              <li key={row.key}>
                {NETWORK_PROFILE_SHORT[row.profile]} · {ladderLabel(row.ladderKind)} · {row.label}:
                measured {mbps(row.throughput.mean)}, profile{" "}
                {mbps(NETWORK_PROFILE_RATE_BPS[row.profile] ?? 0)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {failures.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-destructive select-none">
            {failures.length} run{failures.length === 1 ? "" : "s"} failed and{" "}
            {failures.length === 1 ? "is" : "are"} left out of the means
          </summary>
          <ul className="mt-1.5 space-y-1 pl-4 text-muted-foreground">
            {failures.map((failure, index) => (
              <li
                key={`${describeCellFull(failure.cell, failure.networkProfile)}:${failure.repetition}:${index}`}
              >
                <span className="font-mono">
                  {NETWORK_PROFILE_SHORT[failure.networkProfile]} ·{" "}
                  {ladderLabel(failure.cell.ladderKind)} · {describeCell(failure.cell)} · repetition{" "}
                  {failure.repetition}
                </span>
                : {failure.errorMessage ?? "failed"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The runs played since this page was opened, one row per combination. */
export function BenchmarkSessionResults({ results }: { results: BenchmarkRunResult[] }) {
  const { rows } = useMemo(() => aggregate(results), [results]);

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
        result.metrics.timeWeightedVmaf != null
          ? Number(result.metrics.timeWeightedVmaf.toFixed(3))
          : "",
        encodeResolutionShare(result.metrics.resolutionShare),
        result.metrics.recoveryMs ?? "",
        result.failed ? (result.errorMessage ?? "failed") : "",
      ]),
    [results],
  );

  if (rows.length === 0) {
    return null;
  }

  return (
    <Figure
      title="This session"
      note="Mean ± SD over the repetitions played since this page was opened. Everything is also saved."
      actions={
        <ExportCsvButton
          filename={slugFilename(["benchmark-session"])}
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
      }
    >
      <DataTable
        head={
          <tr className="border-b border-foreground/20">
            <DataHead>Network</DataHead>
            <DataHead>Ladder</DataHead>
            <DataHead>Combination</DataHead>
            <DataHead numeric>Runs</DataHead>
            <DataHead numeric>Startup (ms)</DataHead>
            <DataHead numeric>Session (s)</DataHead>
            <DataHead numeric>Buffering</DataHead>
            <DataHead numeric>Mean buffer (s)</DataHead>
            <DataHead numeric>Switches</DataHead>
            <DataHead numeric>Top rung</DataHead>
            <DataHead numeric>VMAF</DataHead>
            <DataHead numeric>Bitrate</DataHead>
            <DataHead numeric>Throughput</DataHead>
            <DataHead numeric>Dropped</DataHead>
            <DataHead>Resolutions</DataHead>
          </tr>
        }
      >
        {rows.map((row) => {
          const tooFast = exceedsProfileRate(row.profile, row.throughput.mean);
          return (
            <DataRow key={row.key}>
              <DataCell mono={false}>{NETWORK_PROFILE_SHORT[row.profile]}</DataCell>
              <DataCell mono={false}>{ladderLabel(row.ladderKind)}</DataCell>
              <DataCell>{row.label}</DataCell>
              <DataCell numeric>{row.runs}</DataCell>
              <DataCell numeric>
                {row.startup.mean.toFixed(0)} ± {row.startup.stdDev.toFixed(0)}
              </DataCell>
              <DataCell numeric>
                {(row.session.mean / 1000).toFixed(1)} ± {(row.session.stdDev / 1000).toFixed(1)}
              </DataCell>
              <DataCell numeric>{(row.buffering.mean * 100).toFixed(2)} %</DataCell>
              <DataCell numeric>{row.avgBuffer.mean.toFixed(1)}</DataCell>
              <DataCell numeric>
                {row.switches.mean.toFixed(1)} ± {row.switches.stdDev.toFixed(1)}
              </DataCell>
              <DataCell numeric>{row.top ? `${(row.top.mean * 100).toFixed(0)} %` : "—"}</DataCell>
              <DataCell numeric>
                {row.vmaf ? `${row.vmaf.mean.toFixed(2)} ± ${row.vmaf.stdDev.toFixed(2)}` : "—"}
              </DataCell>
              <DataCell numeric>{mbps(row.bitrate.mean)}</DataCell>
              <DataCell
                numeric
                className={tooFast ? "font-semibold text-warning" : undefined}
                title={
                  tooFast
                    ? `Above the profile's ${mbps(NETWORK_PROFILE_RATE_BPS[row.profile] ?? 0)}: shaping did not apply`
                    : undefined
                }
              >
                {row.throughput.mean > 0 ? mbps(row.throughput.mean) : "—"}
              </DataCell>
              <DataCell numeric>{(row.dropped.mean * 100).toFixed(2)} %</DataCell>
              <DataCell last>{describeResolutionShare(row.mix)}</DataCell>
            </DataRow>
          );
        })}
      </DataTable>
    </Figure>
  );
}
