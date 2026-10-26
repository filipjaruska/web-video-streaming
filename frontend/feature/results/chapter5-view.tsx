import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Figure } from "@/components/figure";
import { Section } from "@/components/section";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import { ladderLabel } from "@/lib/analysisFormat";
import { NETWORK_PROFILE_CSV_IDS, NETWORK_PROFILE_SHORT } from "@/lib/benchmark/types";
import {
  HEIGHTS,
  PROFILES,
  STEADY_PROFILES,
  type Chapter5Report,
  type LadderFigures,
  type PerProtocol,
  type Rule,
} from "@/lib/results/chapter5";
import { fixed, multiple, pair, percent, signed, small } from "@/lib/results/format";

import { SavingsChart, SiTiPlaneChart, SteadyStateChart, TuningByCrfChart } from "./results-charts";

export const RESULT_SECTIONS = [
  { id: "content", title: "Content characteristics" },
  { id: "ladders", title: "Ladder design and comparison" },
  { id: "tuning", title: "Codec tuning for animation" },
  { id: "overhead", title: "Computational overhead" },
  { id: "playback", title: "Protocols and ABR" },
  { id: "variable", title: "Variable network" },
] as const;

function VideoLink({ routeId, title }: { routeId: string; title: string }) {
  return (
    <Link
      href={`/${routeId}/results`}
      className="font-medium underline-offset-4 hover:text-primary hover:underline"
    >
      {title}
    </Link>
  );
}

function csv(label: string, headers: string[], rows: Array<Array<string | number | null>>) {
  return (
    <ExportCsvButton
      filename={`results-${label.toLowerCase().replace(/\s+/g, "-")}`}
      headers={headers}
      rows={rows}
    />
  );
}

/** One protocol pair in a cell: "HLS / DASH". */
function perProtocol(values: PerProtocol, format: (value: number | null) => string): string {
  return pair(format(values.hls), format(values.dash));
}

export function Chapter5View({ report }: { report: Chapter5Report }) {
  if (report.videos.length === 0) {
    return <EmptyState title="No videos yet">Upload a video to see results here.</EmptyState>;
  }

  const failedToLoad = report.videos.filter((video) => video.errors.length > 0);

  return (
    <div className="space-y-2">
      {failedToLoad.length > 0 && (
        <ErrorBanner
          title="Some data could not be loaded"
          message={failedToLoad
            .map((video) => `${video.title}: ${video.errors.join("; ")}`)
            .join(" · ")}
        />
      )}
      <ContentSection report={report} />
      <LadderSection report={report} />
      <TuningSection report={report} />
      <OverheadSection report={report} />
      <PlaybackSection report={report} />
      <VariableSection report={report} />
    </div>
  );
}
function ContentSection({ report }: { report: Chapter5Report }) {
  return (
    <Section id="content" title="Content characteristics">
      <Figure
        title="Content of the test videos"
        note="Measured on each source before encoding. SD is over every frame of the video."
        actions={csv(
          "content",
          [
            "video",
            "si_mean",
            "si_sd",
            "ti_mean",
            "ti_sd",
            "duplicate_frame_share",
            "source_cambi",
          ],
          report.content.map((row) => [
            row.title,
            row.siMean,
            row.siStdDev,
            row.tiMean,
            row.tiStdDev,
            row.duplicateFrameShare,
            row.sourceCambi,
          ]),
        )}
      >
        <DataTable
          head={
            <tr className="border-b border-foreground/20">
              <DataHead>Video</DataHead>
              <DataHead numeric>Mean SI</DataHead>
              <DataHead numeric>SI SD</DataHead>
              <DataHead numeric>Mean TI</DataHead>
              <DataHead numeric>TI SD</DataHead>
              <DataHead numeric>Duplicate frames</DataHead>
              <DataHead numeric>Source CAMBI</DataHead>
            </tr>
          }
        >
          {report.content.map((row) => (
            <DataRow key={row.routeId}>
              <DataCell mono={false}>
                <VideoLink routeId={row.routeId} title={row.title} />
              </DataCell>
              <DataCell numeric>{fixed(row.siMean)}</DataCell>
              <DataCell numeric>{fixed(row.siStdDev)}</DataCell>
              <DataCell numeric>{fixed(row.tiMean)}</DataCell>
              <DataCell numeric>{fixed(row.tiStdDev)}</DataCell>
              <DataCell numeric>{percent(row.duplicateFrameShare)}</DataCell>
              <DataCell numeric>{small(row.sourceCambi)}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      </Figure>

      <Figure
        title="Videos in the SI–TI plane"
        note="Shaded: the region ITU-T P.910 gives for live action (SI above 80, TI above 20)."
      >
        <SiTiPlaneChart rows={report.content} />
      </Figure>

      <Figure
        title="Source file over progressive download"
        note="Startup (ms) / buffering ratio, mean over the repetitions."
        actions={csv(
          "progressive",
          ["video", "network", "startup_ms", "buffering_ratio"],
          report.progressive.flatMap((row) =>
            PROFILES.map((profile) => [
              row.title,
              NETWORK_PROFILE_CSV_IDS[profile],
              row.byProfile[profile]?.startupMs ?? null,
              row.byProfile[profile]?.bufferingRatio ?? null,
            ]),
          ),
        )}
      >
        <DataTable
          head={
            <tr className="border-b border-foreground/20">
              <DataHead>Video</DataHead>
              {PROFILES.map((profile) => (
                <DataHead key={profile} numeric>
                  {NETWORK_PROFILE_SHORT[profile]}
                </DataHead>
              ))}
            </tr>
          }
        >
          {report.progressive.map((row) => (
            <DataRow key={row.routeId}>
              <DataCell mono={false}>
                <VideoLink routeId={row.routeId} title={row.title} />
              </DataCell>
              {PROFILES.map((profile) => {
                const cell = row.byProfile[profile];
                return (
                  <DataCell key={profile} numeric>
                    {cell
                      ? pair(`${fixed(cell.startupMs, 0)} ms`, percent(cell.bufferingRatio))
                      : "—"}
                  </DataCell>
                );
              })}
            </DataRow>
          ))}
        </DataTable>
      </Figure>
    </Section>
  );
}

function ladderCells(figures: LadderFigures | null) {
  if (figures?.error) {
    return (
      <DataCell colSpan={3} className="text-muted-foreground">
        {figures.error}
      </DataCell>
    );
  }
  return (
    <>
      <DataCell numeric>{signed(figures?.bdRate)}</DataCell>
      <DataCell numeric>{signed(figures?.bdRateHighBand)}</DataCell>
      <DataCell numeric>{signed(figures?.bdVmaf)}</DataCell>
    </>
  );
}

function LadderSection({ report }: { report: Chapter5Report }) {
  return (
    <Section id="ladders" title="Ladder design and comparison">
      <Figure
        title="Derived ladders against the static ladder"
        note="Rungs: static / content-adaptive / animation-optimised. Negative BD-rate is a saving at equal quality, positive BD-VMAF more quality at equal bitrate. Akima interpolation, PCHIP where Akima is not monotone."
        actions={csv(
          "ladders",
          [
            "video",
            "rungs_static",
            "rungs_content_adaptive",
            "rungs_animation_optimised",
            "ca_bd_rate",
            "ca_bd_rate_vmaf60",
            "ca_bd_vmaf",
            "ao_bd_rate",
            "ao_bd_rate_vmaf60",
            "ao_bd_vmaf",
          ],
          report.ladders.map((row) => [
            row.title,
            row.rungs.static,
            row.rungs.dynamic,
            row.rungs.animation,
            row.ladders.dynamic?.bdRate ?? null,
            row.ladders.dynamic?.bdRateHighBand ?? null,
            row.ladders.dynamic?.bdVmaf ?? null,
            row.ladders.animation?.bdRate ?? null,
            row.ladders.animation?.bdRateHighBand ?? null,
            row.ladders.animation?.bdVmaf ?? null,
          ]),
        )}
      >
        <DataTable
          head={
            <>
              <tr>
                <DataHead rowSpan={2}>Video</DataHead>
                <DataHead rowSpan={2} numeric>
                  Rungs
                </DataHead>
                <DataHead colSpan={3} className="border-b text-center">
                  {ladderLabel("dynamic")}
                </DataHead>
                <DataHead colSpan={3} className="border-b text-center">
                  {ladderLabel("animation")}
                </DataHead>
              </tr>
              <tr className="border-b border-foreground/20">
                {["dynamic", "animation"].flatMap((ladder) => [
                  <DataHead key={`${ladder}-full`} numeric>
                    BD-rate (%)
                  </DataHead>,
                  <DataHead key={`${ladder}-60`} numeric>
                    BD-rate, VMAF ≥ 60
                  </DataHead>,
                  <DataHead key={`${ladder}-vmaf`} numeric>
                    BD-VMAF
                  </DataHead>,
                ])}
              </tr>
            </>
          }
        >
          {report.ladders.map((row) => (
            <DataRow key={row.routeId}>
              <DataCell mono={false}>
                <VideoLink routeId={row.routeId} title={row.title} />
              </DataCell>
              <DataCell numeric>
                {[row.rungs.static, row.rungs.dynamic, row.rungs.animation]
                  .map((count) => count ?? "—")
                  .join(" / ")}
              </DataCell>
              {ladderCells(row.ladders.dynamic)}
              {ladderCells(row.ladders.animation)}
            </DataRow>
          ))}
        </DataTable>
      </Figure>

      <Figure
        title="Bitrate saving of the derived ladders against temporal complexity"
        note="Saving is the full-range BD-rate with the sign flipped."
      >
        <SavingsChart points={report.savings} />
      </Figure>
    </Section>
  );
}

function TuningSection({ report }: { report: Chapter5Report }) {
  return (
    <Section id="tuning" title="Codec tuning for animation">
      <Figure
        title="Effect of -tune animation over paired encode-grid samples"
        note="n is the number of pairs at the same resolution and CRF; ΔVMAF (mean over frames) and ΔCAMBI are means over them, a positive ΔCAMBI is more banding. BD-rate is fitted per resolution over both grids' curves (Akima); the mean is over resolutions."
        actions={csv(
          "tuning",
          [
            "video",
            "pairs",
            "vmaf_delta",
            "cambi_delta",
            ...HEIGHTS.map((height) => `bd_rate_${height}p`),
            "bd_rate_mean",
          ],
          report.tuning.map((row) => [
            row.title,
            row.pairs,
            row.vmafDelta,
            row.cambiDelta,
            ...HEIGHTS.map((height) => row.bdRateByHeight[height]),
            row.bdRateMean,
          ]),
        )}
      >
        <DataTable
          head={
            <>
              <tr>
                <DataHead rowSpan={2}>Video</DataHead>
                <DataHead rowSpan={2} numeric>
                  n
                </DataHead>
                <DataHead rowSpan={2} numeric>
                  ΔVMAF
                </DataHead>
                <DataHead rowSpan={2} numeric>
                  ΔCAMBI
                </DataHead>
                <DataHead colSpan={HEIGHTS.length + 1} className="border-b text-center">
                  BD-rate (%)
                </DataHead>
              </tr>
              <tr className="border-b border-foreground/20">
                {HEIGHTS.map((height) => (
                  <DataHead key={height} numeric>
                    {height}p
                  </DataHead>
                ))}
                <DataHead numeric>Mean</DataHead>
              </tr>
            </>
          }
        >
          {report.tuning.map((row) => (
            <DataRow key={row.routeId}>
              <DataCell mono={false}>
                <VideoLink routeId={row.routeId} title={row.title} />
              </DataCell>
              <DataCell numeric>{row.pairs ?? "—"}</DataCell>
              <DataCell numeric>{signed(row.vmafDelta, 3)}</DataCell>
              <DataCell numeric>{signed(row.cambiDelta, 3)}</DataCell>
              {HEIGHTS.map((height) => (
                <DataCell key={height} numeric>
                  {signed(row.bdRateByHeight[height])}
                </DataCell>
              ))}
              <DataCell numeric className="font-semibold">
                {signed(row.bdRateMean)}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      </Figure>

      <div className="grid gap-8 lg:grid-cols-2">
        <Figure
          title="Change in VMAF from tuning against CRF"
          note="Mean over the resolutions, at the CRFs where both grids encoded every resolution."
        >
          <TuningByCrfChart series={report.tuningByCrf} metric="vmafDelta" />
        </Figure>
        <Figure
          title="Change in CAMBI from tuning against CRF"
          note="Positive means more banding with tuning."
        >
          <TuningByCrfChart series={report.tuningByCrf} metric="cambiDelta" />
        </Figure>
      </div>
    </Section>
  );
}

function OverheadSection({ report }: { report: Chapter5Report }) {
  return (
    <Section id="overhead" title="Computational overhead">
      <Figure
        title="Relative cost of the processing phases"
        note="Multiples of encoding and packaging the static ladder of the same video. The production path is both grids, the derivation, and encoding plus packaging the animation-optimised ladder."
        actions={csv(
          "overhead",
          [
            "video",
            "grid_samples_default",
            "grid_samples_tuned",
            "default_grid_x",
            "tuned_grid_x",
            "ladder_encode_package_x",
            "production_path_x",
          ],
          report.overhead.map((row) => [
            row.title,
            row.samplesDefault,
            row.samplesTuned,
            row.defaultGrid,
            row.tunedGrid,
            row.ladderEncode,
            row.productionPath,
          ]),
        )}
      >
        <DataTable
          head={
            <tr className="border-b border-foreground/20">
              <DataHead>Video</DataHead>
              <DataHead numeric>Grid samples (default / tuned)</DataHead>
              <DataHead numeric>Default grid</DataHead>
              <DataHead numeric>Tuned grid</DataHead>
              <DataHead numeric>Ladder encode and package</DataHead>
              <DataHead numeric>Production path</DataHead>
            </tr>
          }
        >
          {report.overhead.map((row) => (
            <DataRow key={row.routeId}>
              <DataCell mono={false}>
                <VideoLink routeId={row.routeId} title={row.title} />
              </DataCell>
              <DataCell numeric>
                {pair(String(row.samplesDefault ?? "—"), String(row.samplesTuned ?? "—"))}
              </DataCell>
              <DataCell numeric>{multiple(row.defaultGrid)}</DataCell>
              <DataCell numeric>{multiple(row.tunedGrid)}</DataCell>
              <DataCell numeric>{multiple(row.ladderEncode)}</DataCell>
              <DataCell numeric className="font-semibold">
                {multiple(row.productionPath)}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      </Figure>
    </Section>
  );
}

const RULES: Rule[] = ["throughput", "hybrid", "buffer"];

function PlaybackSection({ report }: { report: Chapter5Report }) {
  return (
    <Section
      id="playback"
      title="Protocols and ABR"
      description={`${report.runs.total} playback runs over all videos${report.runs.failed > 0 ? `; ${report.runs.failed} did not start and are left out of the means` : ""}.`}
    >
      <Figure
        title="Delivered quality, HLS against DASH"
        note="HLS − DASH in points of time-weighted harmonic VMAF over the session, as throughput / hybrid rule. Positive means higher quality over HLS."
        actions={csv(
          "protocols",
          ["video", "ladder", "network", "throughput_hls_minus_dash", "hybrid_hls_minus_dash"],
          report.protocols.flatMap((row) =>
            PROFILES.map((profile) => [
              row.title,
              row.ladder,
              NETWORK_PROFILE_CSV_IDS[profile],
              row.byProfile[profile].throughput,
              row.byProfile[profile].hybrid,
            ]),
          ),
        )}
      >
        <DataTable
          head={
            <tr className="border-b border-foreground/20">
              <DataHead>Video</DataHead>
              <DataHead>Ladder</DataHead>
              {PROFILES.map((profile) => (
                <DataHead key={profile} numeric>
                  {NETWORK_PROFILE_SHORT[profile]}
                </DataHead>
              ))}
            </tr>
          }
        >
          {report.protocols.map((row) => (
            <DataRow key={`${row.routeId}-${row.ladder}`}>
              <DataCell mono={false}>
                {row.ladder === "static" && <VideoLink routeId={row.routeId} title={row.title} />}
              </DataCell>
              <DataCell mono={false} className="text-muted-foreground">
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

      <Figure
        title="Delivered quality and bitrate, animation-optimised against static"
        note="ΔVMAF is animation-optimised − static in points of time-weighted harmonic VMAF; steady state leaves out the first 6 s segment. Saving is the relative reduction of time-weighted bitrate, negative means more bits. Both protocols and all repetitions averaged."
        actions={csv(
          "ladder-playback",
          [
            "network",
            "video",
            ...RULES.flatMap((rule) => [
              `${rule}_vmaf_delta_session`,
              `${rule}_vmaf_delta_steady`,
              `${rule}_bitrate_saving`,
            ]),
          ],
          report.ladderPlayback.map((row) => [
            NETWORK_PROFILE_CSV_IDS[row.profile],
            row.title,
            ...RULES.flatMap((rule) => [
              row.byRule[rule].wholeDelta,
              row.byRule[rule].steadyDelta,
              row.byRule[rule].saving,
            ]),
          ]),
        )}
      >
        <DataTable
          head={
            <>
              <tr>
                <DataHead rowSpan={2}>Network</DataHead>
                <DataHead rowSpan={2}>Video</DataHead>
                <DataHead colSpan={3} className="border-b text-center">
                  Throughput
                </DataHead>
                <DataHead colSpan={3} className="border-b text-center">
                  Hybrid
                </DataHead>
                <DataHead colSpan={2} className="border-b text-center">
                  Buffer
                </DataHead>
              </tr>
              <tr className="border-b border-foreground/20">
                {["throughput", "hybrid"].flatMap((rule) => [
                  <DataHead key={`${rule}-s`} numeric>
                    ΔVMAF session
                  </DataHead>,
                  <DataHead key={`${rule}-ss`} numeric>
                    ΔVMAF steady
                  </DataHead>,
                  <DataHead key={`${rule}-b`} numeric>
                    Saving (%)
                  </DataHead>,
                ])}
                <DataHead numeric>ΔVMAF session</DataHead>
                <DataHead numeric>Saving (%)</DataHead>
              </tr>
            </>
          }
        >
          {STEADY_PROFILES.flatMap((profile) => {
            const rows = report.ladderPlayback.filter((row) => row.profile === profile);
            return rows.map((row, index) => (
              <DataRow
                key={`${profile}-${row.routeId}`}
                className={index === rows.length - 1 ? "border-b-foreground/20" : undefined}
              >
                <DataCell mono={false} className="font-medium">
                  {index === 0 ? NETWORK_PROFILE_SHORT[profile] : ""}
                </DataCell>
                <DataCell mono={false}>
                  <VideoLink routeId={row.routeId} title={row.title} />
                </DataCell>
                {(["throughput", "hybrid"] as const).flatMap((rule) => [
                  <DataCell key={`${rule}-s`} numeric>
                    {signed(row.byRule[rule].wholeDelta)}
                  </DataCell>,
                  <DataCell key={`${rule}-ss`} numeric>
                    {signed(row.byRule[rule].steadyDelta)}
                  </DataCell>,
                  <DataCell key={`${rule}-b`} numeric>
                    {fixed(row.byRule[rule].saving, 1)}
                  </DataCell>,
                ])}
                <DataCell numeric>{signed(row.byRule.buffer.wholeDelta)}</DataCell>
                <DataCell numeric>{fixed(row.byRule.buffer.saving, 1)}</DataCell>
              </DataRow>
            ));
          })}
        </DataTable>
      </Figure>

      <Figure
        title="Animation-optimised against static, whole session and steady state"
        note="Throughput rule, 4G profile, points of time-weighted harmonic VMAF."
      >
        <SteadyStateChart points={report.steadyState} />
      </Figure>
    </Section>
  );
}

function VariableSection({ report }: { report: Chapter5Report }) {
  return (
    <Section id="variable" title="Variable network">
      <Figure
        title="Playback over 4G, 3G and back to 4G"
        note="Values as HLS / DASH, mean over the repetitions. Target buffer 8 s; VMAF is time-weighted harmonic over the session."
        actions={csv(
          "variable",
          [
            "video",
            "ladder",
            "throughput_buffering_hls",
            "throughput_buffering_dash",
            "throughput_stall_s_hls",
            "throughput_stall_s_dash",
            "throughput_vmaf_hls",
            "throughput_vmaf_dash",
            "buffer_vmaf_hls",
            "buffer_vmaf_dash",
          ],
          report.variable.map((row) => [
            row.title,
            row.ladder,
            row.throughput.bufferingPercent.hls,
            row.throughput.bufferingPercent.dash,
            row.throughput.stallSec.hls,
            row.throughput.stallSec.dash,
            row.throughput.vmaf.hls,
            row.throughput.vmaf.dash,
            row.buffer.vmaf.hls,
            row.buffer.vmaf.dash,
          ]),
        )}
      >
        <DataTable
          head={
            <>
              <tr>
                <DataHead rowSpan={2}>Video</DataHead>
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
          {report.variable.map((row) => (
            <DataRow key={`${row.routeId}-${row.ladder}`}>
              <DataCell mono={false}>
                {row.ladder === "static" && <VideoLink routeId={row.routeId} title={row.title} />}
              </DataCell>
              <DataCell mono={false} className="text-muted-foreground">
                {ladderLabel(row.ladder)}
              </DataCell>
              <DataCell numeric>
                {perProtocol(row.throughput.bufferingPercent, (value) => fixed(value, 1))}
              </DataCell>
              <DataCell numeric>
                {perProtocol(row.throughput.stallSec, (value) => fixed(value, 1))}
              </DataCell>
              <DataCell numeric>
                {perProtocol(row.throughput.vmaf, (value) => fixed(value))}
              </DataCell>
              <DataCell numeric>{perProtocol(row.buffer.vmaf, (value) => fixed(value))}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      </Figure>
    </Section>
  );
}
