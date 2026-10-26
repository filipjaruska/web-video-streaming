import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Figure } from "@/components/figure";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import { ladderLabel } from "@/lib/analysisFormat";
import { NETWORK_PROFILE_SHORT } from "@/lib/benchmark/types";
import { PROFILES, STEADY_PROFILES, type Chapter5Report } from "@/lib/results/chapter5";
import { fixed, pair, percent, signed } from "@/lib/results/format";

/**
 * This video's saved playback runs, pivoted the way the results page presents all videos.
 * Expects a report built from this video alone.
 */
export function VideoPlayback({ report, routeId }: { report: Chapter5Report; routeId: string }) {
  const progressive = report.progressive[0];
  const protocols = report.protocols;
  const ladderPlayback = report.ladderPlayback;
  const variable = report.variable;

  if (report.runs.total === 0) {
    return (
      <EmptyState title="No playback runs saved">
        Run them from the{" "}
        <Link href={`/${routeId}/benchmark`} className="underline underline-offset-4">
          Benchmark tab
        </Link>
        .
      </EmptyState>
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {report.runs.total} runs saved
        {report.runs.failed > 0 && `, ${report.runs.failed} did not start and are left out`}. Every
        cell is the mean over its repetitions;{" "}
        <Link href={`/${routeId}/benchmark`} className="underline underline-offset-4">
          all cells
        </Link>{" "}
        are on the Benchmark tab.
      </p>

      <div className="grid gap-8 xl:grid-cols-2">
        <Figure
          title="Source file over progressive download"
          note="Startup and buffering ratio, mean over the repetitions."
        >
          <DataTable headers={["Network", "Startup", "Buffering"]}>
            {PROFILES.map((profile) => {
              const cell = progressive?.byProfile[profile];
              return (
                <DataRow key={profile}>
                  <DataCell mono={false}>{NETWORK_PROFILE_SHORT[profile]}</DataCell>
                  <DataCell numeric>{cell ? `${fixed(cell.startupMs, 0)} ms` : "—"}</DataCell>
                  <DataCell numeric last>
                    {cell ? percent(cell.bufferingRatio) : "—"}
                  </DataCell>
                </DataRow>
              );
            })}
          </DataTable>
        </Figure>

        <Figure
          title="HLS against DASH"
          note="HLS − DASH in points of time-weighted harmonic VMAF, throughput / hybrid rule."
        >
          <DataTable
            head={
              <tr className="border-b border-foreground/20">
                <DataHead>Ladder</DataHead>
                {PROFILES.map((profile) => (
                  <DataHead key={profile} numeric>
                    {NETWORK_PROFILE_SHORT[profile]}
                  </DataHead>
                ))}
              </tr>
            }
          >
            {protocols.map((row) => (
              <DataRow key={row.ladder}>
                <DataCell mono={false} className="whitespace-nowrap">
                  {ladderLabel(row.ladder)}
                </DataCell>
                {PROFILES.map((profile) => (
                  <DataCell key={profile} numeric>
                    {pair(
                      signed(row.byProfile[profile].throughput),
                      signed(row.byProfile[profile].hybrid),
                    )}
                  </DataCell>
                ))}
              </DataRow>
            ))}
          </DataTable>
        </Figure>
      </div>

      <Figure
        title="Animation-optimised against static"
        note="ΔVMAF is animation-optimised − static, time-weighted harmonic VMAF; steady state leaves out the first 6 s segment. Saving is the relative reduction of time-weighted bitrate. Both protocols averaged."
      >
        <DataTable
          head={
            <>
              <tr>
                <DataHead rowSpan={2}>Network</DataHead>
                {(["throughput", "hybrid", "buffer"] as const).map((rule) => (
                  <DataHead key={rule} colSpan={3} className="border-b text-center capitalize">
                    {rule}
                  </DataHead>
                ))}
              </tr>
              <tr className="border-b border-foreground/20">
                {(["throughput", "hybrid", "buffer"] as const).flatMap((rule) => [
                  <DataHead key={`${rule}-s`} numeric>
                    Session
                  </DataHead>,
                  <DataHead key={`${rule}-ss`} numeric>
                    Steady
                  </DataHead>,
                  <DataHead key={`${rule}-b`} numeric>
                    Saving (%)
                  </DataHead>,
                ])}
              </tr>
            </>
          }
        >
          {STEADY_PROFILES.map((profile) => {
            const row = ladderPlayback.find((item) => item.profile === profile);
            return (
              <DataRow key={profile}>
                <DataCell mono={false}>{NETWORK_PROFILE_SHORT[profile]}</DataCell>
                {(["throughput", "hybrid", "buffer"] as const).flatMap((rule) => [
                  <DataCell key={`${rule}-s`} numeric>
                    {signed(row?.byRule[rule].wholeDelta)}
                  </DataCell>,
                  <DataCell key={`${rule}-ss`} numeric>
                    {signed(row?.byRule[rule].steadyDelta)}
                  </DataCell>,
                  <DataCell key={`${rule}-b`} numeric>
                    {fixed(row?.byRule[rule].saving, 1)}
                  </DataCell>,
                ])}
              </DataRow>
            );
          })}
        </DataTable>
      </Figure>

      <Figure
        title="Variable network: 4G, 3G, back to 4G"
        note="HLS / DASH. Buffering, stalled time and VMAF under the throughput rule, VMAF under the buffer rule."
      >
        <DataTable
          head={
            <>
              <tr>
                <DataHead rowSpan={2}>Ladder</DataHead>
                <DataHead colSpan={3} className="border-b text-center">
                  Throughput rule
                </DataHead>
                <DataHead className="border-b text-center">Buffer rule</DataHead>
              </tr>
              <tr className="border-b border-foreground/20">
                <DataHead numeric>Buffering (%)</DataHead>
                <DataHead numeric>Stalled (s)</DataHead>
                <DataHead numeric>VMAF</DataHead>
                <DataHead numeric>VMAF</DataHead>
              </tr>
            </>
          }
        >
          {variable.map((row) => (
            <DataRow key={row.ladder}>
              <DataCell mono={false} className="whitespace-nowrap">
                {ladderLabel(row.ladder)}
              </DataCell>
              <DataCell numeric>
                {pair(
                  fixed(row.throughput.bufferingPercent.hls, 1),
                  fixed(row.throughput.bufferingPercent.dash, 1),
                )}
              </DataCell>
              <DataCell numeric>
                {pair(
                  fixed(row.throughput.stallSec.hls, 1),
                  fixed(row.throughput.stallSec.dash, 1),
                )}
              </DataCell>
              <DataCell numeric>
                {pair(fixed(row.throughput.vmaf.hls), fixed(row.throughput.vmaf.dash))}
              </DataCell>
              <DataCell numeric last>
                {pair(fixed(row.buffer.vmaf.hls), fixed(row.buffer.vmaf.dash))}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      </Figure>
    </>
  );
}
