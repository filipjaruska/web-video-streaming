import { EmptyState } from "@/components/empty-state";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Figure } from "@/components/figure";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import { ladderLabel } from "@/lib/analysisFormat";
import { algorithmLabel } from "@/lib/benchmark/matrix";
import {
  NETWORK_PROFILE_CSV_IDS,
  NETWORK_PROFILE_SHORT,
  type NetworkProfile,
} from "@/lib/benchmark/types";
import { fixed, percent } from "@/lib/results/format";
import {
  profileOf,
  type BenchmarkAggregateDto,
  type BenchmarkRunDto,
} from "@/lib/videoBenchmarksApi";

const PROFILE_ORDER: NetworkProfile[] = ["standard", "fourG", "threeG", "variable"];
const LADDER_ORDER = ["source", "static", "dynamic", "animation"];
const PROTOCOL_ORDER = ["source", "hls", "dash"];
const RULE_ORDER = ["throughput", "hybrid", "buffer", "baseline"];

function rank(order: readonly string[], value: string): number {
  const position = order.indexOf(value);
  return position < 0 ? order.length : position;
}

function sortAggregates(aggregates: BenchmarkAggregateDto[]): BenchmarkAggregateDto[] {
  return aggregates.toSorted(
    (a, b) =>
      rank(PROFILE_ORDER, profileOf(a)) - rank(PROFILE_ORDER, profileOf(b)) ||
      rank(LADDER_ORDER, a.ladderKind) - rank(LADDER_ORDER, b.ladderKind) ||
      rank(PROTOCOL_ORDER, a.protocol) - rank(PROTOCOL_ORDER, b.protocol) ||
      rank(RULE_ORDER, a.abrAlgorithm) - rank(RULE_ORDER, b.abrAlgorithm),
  );
}

const mbps = (bps: number) => fixed(bps / 1_000_000);

/** Every saved cell for this video, averaged over its repetitions by the server. */
export function SavedBenchmarks({
  aggregates,
  runs,
}: {
  aggregates: BenchmarkAggregateDto[];
  runs: BenchmarkRunDto[];
}) {
  if (aggregates.length === 0) {
    return (
      <EmptyState title="Nothing saved yet">Runs appear here as soon as they finish.</EmptyState>
    );
  }

  const rows = sortAggregates(aggregates);
  const failed = runs.filter((run) => run.failed).length;

  return (
    <Figure
      title="Every saved combination"
      note={`${runs.length} runs${failed > 0 ? `, ${failed} did not start and are left out of the means` : ""}. Mean ± SD over the repetitions; VMAF is time-weighted harmonic VMAF of the rungs played, bitrate the time-weighted bitrate.`}
      actions={
        <>
          <ExportCsvButton
            label="Runs CSV"
            filename="benchmark-runs"
            headers={[
              "network_profile",
              "ladder",
              "protocol",
              "abr_rule",
              "repetition",
              "startup_ms",
              "buffering_ratio",
              "rebuffer_count",
              "rebuffer_ms",
              "quality_switches",
              "oscillations",
              "time_weighted_bitrate_mbps",
              "dropped_frame_ratio",
              "recovery_ms",
              "failed",
              "error",
              "created_at_utc",
            ]}
            rows={runs.map((run) => [
              NETWORK_PROFILE_CSV_IDS[profileOf(run)],
              run.ladderKind,
              run.protocol,
              run.abrAlgorithm,
              run.repetition,
              run.startupMs ?? "",
              run.bufferingRatio,
              run.rebufferCount,
              run.rebufferMs,
              run.qualitySwitches,
              run.oscillations,
              run.timeWeightedBitrateBps / 1_000_000,
              run.droppedFrameRatio,
              run.recoveryMs ?? "",
              run.failed ? 1 : 0,
              run.errorMessage ?? "",
              run.createdAtUtc,
            ])}
          />
          <ExportCsvButton
            label="Combinations CSV"
            filename="benchmark-aggregates"
            headers={[
              "network_profile",
              "ladder",
              "protocol",
              "abr_rule",
              "runs",
              "startup_ms_mean",
              "startup_ms_sd",
              "buffering_ratio_mean",
              "rebuffer_ms_mean",
              "rebuffer_count_mean",
              "quality_switches_mean",
              "time_weighted_bitrate_mbps",
              "time_weighted_vmaf_mean",
              "time_weighted_vmaf_sd",
            ]}
            rows={rows.map((row) => [
              NETWORK_PROFILE_CSV_IDS[profileOf(row)],
              row.ladderKind,
              row.protocol,
              row.abrAlgorithm,
              row.runs,
              row.startupMsMean,
              row.startupMsStdDev,
              row.bufferingRatioMean,
              row.rebufferMsMean,
              row.rebufferCountMean,
              row.qualitySwitchesMean,
              row.timeWeightedBitrateBpsMean / 1_000_000,
              row.timeWeightedVmafMean ?? "",
              row.timeWeightedVmafStdDev ?? "",
            ])}
          />
        </>
      }
    >
      <DataTable
        head={
          <tr className="border-b border-foreground/20">
            <DataHead>Network</DataHead>
            <DataHead>Ladder</DataHead>
            <DataHead>Delivery</DataHead>
            <DataHead>ABR rule</DataHead>
            <DataHead numeric>Runs</DataHead>
            <DataHead numeric>Startup (ms)</DataHead>
            <DataHead numeric>Buffering</DataHead>
            <DataHead numeric>Stalled (s)</DataHead>
            <DataHead numeric>Switches</DataHead>
            <DataHead numeric>Bitrate (Mb/s)</DataHead>
            <DataHead numeric>VMAF</DataHead>
          </tr>
        }
      >
        {rows.map((row, index) => {
          const profile = profileOf(row);
          const firstOfProfile = index === 0 || profileOf(rows[index - 1]) !== profile;
          return (
            <DataRow
              key={`${profile}-${row.ladderKind}-${row.protocol}-${row.abrAlgorithm}`}
              className={
                firstOfProfile && index > 0 ? "border-t border-t-foreground/20" : undefined
              }
            >
              <DataCell mono={false} className="font-medium">
                {firstOfProfile ? NETWORK_PROFILE_SHORT[profile] : ""}
              </DataCell>
              <DataCell mono={false}>{ladderLabel(row.ladderKind)}</DataCell>
              <DataCell mono={false} className="uppercase">
                {row.protocol === "source" ? "range" : row.protocol}
              </DataCell>
              <DataCell mono={false}>
                {row.protocol === "source" ? "—" : algorithmLabel(row.abrAlgorithm)}
              </DataCell>
              <DataCell numeric>{row.runs}</DataCell>
              <DataCell numeric>
                {fixed(row.startupMsMean, 0)} ± {fixed(row.startupMsStdDev, 0)}
              </DataCell>
              <DataCell numeric>{percent(row.bufferingRatioMean, 2)}</DataCell>
              <DataCell numeric>{fixed(row.rebufferMsMean / 1000, 1)}</DataCell>
              <DataCell numeric>{fixed(row.qualitySwitchesMean, 1)}</DataCell>
              <DataCell numeric>{mbps(row.timeWeightedBitrateBpsMean)}</DataCell>
              <DataCell numeric last>
                {row.timeWeightedVmafMean != null
                  ? `${fixed(row.timeWeightedVmafMean)} ± ${fixed(row.timeWeightedVmafStdDev)}`
                  : "—"}
              </DataCell>
            </DataRow>
          );
        })}
      </DataTable>
    </Figure>
  );
}
