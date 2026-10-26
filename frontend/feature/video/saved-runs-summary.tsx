import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Figure } from "@/components/figure";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import {
  BENCHMARK_ALGORITHMS,
  BENCHMARK_PROTOCOLS,
  BENCHMARK_REPETITIONS,
} from "@/lib/benchmark/matrix";
import { NETWORK_PROFILE_SHORT, type NetworkProfile } from "@/lib/benchmark/types";
import { profileOf, type BenchmarkRunDto } from "@/lib/videoBenchmarksApi";

const PROFILES: NetworkProfile[] = ["standard", "fourG", "threeG", "variable"];

/** The three ladders every processed video gets. */
const LADDERS = 3;

/** Combinations in a full sweep of one network: each ladder × protocol × rule, plus the source. */
const COMBINATIONS = LADDERS * BENCHMARK_PROTOCOLS.length * BENCHMARK_ALGORITHMS.length + 1;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * How much of the benchmark has been run for this video, per network: runs saved against a full
 * sweep, failures, and combinations with all their repetitions. The figures themselves are on the
 * Results tab, every combination on Raw data.
 */
export function SavedRunsSummary({ routeId, runs }: { routeId: string; runs: BenchmarkRunDto[] }) {
  if (runs.length === 0) {
    return (
      <EmptyState title="Nothing saved yet">Runs are saved as soon as each finishes.</EmptyState>
    );
  }

  const rows = PROFILES.map((profile) => {
    const ofProfile = runs.filter((run) => profileOf(run) === profile);
    const started = ofProfile.filter((run) => !run.failed);
    const perCombination = new Map<string, number>();
    for (const run of started) {
      const key = `${run.ladderKind}|${run.protocol}|${run.abrAlgorithm}`;
      perCombination.set(key, (perCombination.get(key) ?? 0) + 1);
    }
    const complete = [...perCombination.values()].filter(
      (count) => count >= BENCHMARK_REPETITIONS,
    ).length;
    const last = ofProfile
      .map((run) => run.createdAtUtc)
      .toSorted()
      .at(-1);
    return {
      profile,
      saved: ofProfile.length,
      failed: ofProfile.length - started.length,
      complete,
      last,
    };
  });

  return (
    <Figure
      title="Saved runs"
      note={
        <>
          A full sweep of one network is {COMBINATIONS * BENCHMARK_REPETITIONS} runs: {COMBINATIONS}{" "}
          combinations, {BENCHMARK_REPETITIONS} times each. The measured figures are on the{" "}
          <Link href={`/${routeId}/results#playback`} className="underline underline-offset-4">
            Results tab
          </Link>
          , every combination on{" "}
          <Link href={`/${routeId}/raw#benchmarks`} className="underline underline-offset-4">
            Raw data
          </Link>
          .
        </>
      }
    >
      <DataTable
        head={
          <tr className="border-b border-foreground/20">
            <DataHead>Network</DataHead>
            <DataHead numeric>Runs saved</DataHead>
            <DataHead numeric>Did not start</DataHead>
            <DataHead numeric>Combinations complete</DataHead>
            <DataHead numeric>Last run</DataHead>
          </tr>
        }
      >
        {rows.map((row) => (
          <DataRow key={row.profile}>
            <DataCell mono={false} className="font-medium">
              {NETWORK_PROFILE_SHORT[row.profile]}
            </DataCell>
            <DataCell numeric>
              {row.saved} of {COMBINATIONS * BENCHMARK_REPETITIONS}
            </DataCell>
            <DataCell numeric className={row.failed > 0 ? "text-warning" : undefined}>
              {row.failed}
            </DataCell>
            <DataCell
              numeric
              className={row.complete === COMBINATIONS ? "text-success" : undefined}
            >
              {row.complete} of {COMBINATIONS}
            </DataCell>
            <DataCell numeric last>
              {row.last ? formatDate(row.last) : "—"}
            </DataCell>
          </DataRow>
        ))}
      </DataTable>
    </Figure>
  );
}
