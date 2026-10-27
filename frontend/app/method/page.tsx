import Link from "next/link";
import type { Metadata } from "next";

import { PageShell } from "@/components/page-shell";
import { Section } from "@/components/section";
import { SectionIndex } from "@/components/section-index";
import { DataCell, DataHead, DataRow, DataTable } from "@/components/ui/data-table";
import { BrowserCapabilities } from "@/feature/method/browser-capabilities";
import { HullDiagram } from "@/feature/method/hull-diagram";
import { NETWORK_PROFILE_SHORT, VARIABLE_NETWORK_SCHEDULE } from "@/lib/benchmark/types";
import { loadCatalogue, perRequest } from "@/lib/serverCache";
import { METHOD_COPY } from "@/lib/siteCopy";

export const metadata: Metadata = {
  title: METHOD_COPY.title,
  description: METHOD_COPY.description,
};

/**
 * The static ladder, mirroring `TranscodeProfile.Default` on the backend: Apple's HLS authoring
 * specification, one rung per resolution. Kept here so the page renders with an empty catalogue;
 * update it together with the backend default.
 */
const STATIC_LADDER = [
  { label: "1080p", resolution: "1920×1080", bitrate: "7.80" },
  { label: "720p", resolution: "1280×720", bitrate: "4.50" },
  { label: "540p", resolution: "960×540", bitrate: "2.00" },
  { label: "432p", resolution: "768×432", bitrate: "1.10" },
  { label: "360p", resolution: "640×360", bitrate: "0.365" },
  { label: "234p", resolution: "416×234", bitrate: "0.145" },
];

const NETWORKS = [
  { profile: "standard", rate: "unshaped", rtt: "—", loss: "—" },
  { profile: "fourG", rate: "20", rtt: "40 ms", loss: "1 %" },
  { profile: "threeG", rate: "2", rtt: "100 ms", loss: "5 %" },
] as const;

const ABR_RULES = [
  {
    rule: "Throughput",
    how: "Highest rung that fits in 90 % of the throughput estimate to switch up; a rung is left once it no longer fits in 100 %.",
  },
  {
    rule: "Buffer (BOLA)",
    how: "BOLA-BASIC: chooses on buffer level alone, weighing each rung's utility against its segment size.",
  },
  {
    rule: "Hybrid",
    how: "Throughput until the buffer reaches half its target, then BOLA; back to throughput below a quarter. The arrangement of dash.js DYNAMIC.",
  },
  {
    rule: "Baseline",
    how: "Holds the top rung, no adaptation. The reference for what the network can carry.",
  },
];

const SECTIONS = [
  { id: "content", title: "Content measures" },
  { id: "ladders", title: "Ladders" },
  { id: "quality", title: "Quality metrics" },
  { id: "delivery", title: "Delivery and ABR" },
  { id: "networks", title: "Network profiles" },
  { id: "browser", title: "This browser" },
] as const;

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
      <dt className="font-medium">{name}</dt>
      <dd className="space-y-2 text-sm text-muted-foreground">{children}</dd>
    </div>
  );
}

export default async function MethodPage() {
  // Links point at a real video, so "see it on a video" lands on measured data.
  const sample = await loadCatalogue()
    .then(({ videos }) => (videos.find((video) => video.status === "ready") ?? videos[0])?.routeId)
    .catch(() => perRequest(undefined));
  const onVideo = (section: string) =>
    sample ? (
      <Link href={`/${sample}/results#${section}`} className="text-sm underline underline-offset-4">
        See it on a video
      </Link>
    ) : undefined;

  return (
    <PageShell title={METHOD_COPY.title} description={METHOD_COPY.description}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <SectionIndex sections={SECTIONS} />

        <div className="max-w-4xl">
          <Section id="content" title="Content measures" actions={onVideo("content")}>
            <dl>
              <Term name="SI and TI">
                <p>
                  Spatial and temporal information from ITU-T P.910, computed for every frame of the
                  source. SI is the edge energy within a frame, TI the difference from the previous
                  frame. The results report the mean and the population SD over all frames.
                </p>
              </Term>
              <Term name="Duplicate frames">
                <p>
                  The share of frames with TI below 2: frames that repeat the one before, as in
                  animation drawn on twos. The threshold sits just above the coding noise a held
                  drawing still carries in a lossy master.
                </p>
              </Term>
              <Term name="Source CAMBI">
                <p>Banding already present in the source, before any encoding. 0 is none.</p>
              </Term>
            </dl>
          </Section>

          <Section id="ladders" title="Ladders" actions={onVideo("ladder")}>
            <dl>
              <Term name="Static">
                <p>
                  The H.264 ladder from Apple&apos;s HLS authoring specification, the same six rungs
                  for every video.
                </p>
                <DataTable
                  head={
                    <tr className="border-b border-foreground/20">
                      <DataHead>Rung</DataHead>
                      <DataHead>Resolution</DataHead>
                      <DataHead numeric>Bitrate (Mb/s)</DataHead>
                    </tr>
                  }
                >
                  {STATIC_LADDER.map((rung) => (
                    <DataRow key={rung.label}>
                      <DataCell>{rung.label}</DataCell>
                      <DataCell>{rung.resolution}</DataCell>
                      <DataCell numeric last>
                        {rung.bitrate}
                      </DataCell>
                    </DataRow>
                  ))}
                </DataTable>
              </Term>
              <Term name="Encode grid">
                <p>
                  The video encoded at every resolution over a sweep of CRF values, each encode
                  scored with VMAF against the source. The animation grid repeats it with{" "}
                  <code className="font-mono text-xs">-tune animation</code>, which lowers
                  deblocking and changes psy-RD for flat areas with hard edges.
                </p>
              </Term>
              <Term name="Convex hull and λ">
                <p>
                  On log bitrate, the upper envelope of all resolutions&apos; curves. Every rung is
                  taken where its resolution&apos;s hull has the same slope λ, in VMAF per doubling
                  of bitrate. λ starts at 4 and moves only to keep the top rung between harmonic
                  VMAF 88 and 95.
                </p>
                <HullDiagram />
              </Term>
              <Term name="Crossover">
                <p>
                  The bitrate where the envelope passes from one resolution to the next. Each rung
                  stays between the crossovers either side of it.
                </p>
              </Term>
              <Term name="Content-adaptive">
                <p>Derived from the default grid, encoded as 2-pass VBR with maxrate 1.5×.</p>
              </Term>
              <Term name="Animation-optimised">
                <p>
                  Derived from both grids pooled, each rung free to take either setting, chosen on
                  harmonic VMAF minus a CAMBI penalty so banding counts against a rung.
                </p>
              </Term>
            </dl>
          </Section>

          <Section id="quality" title="Quality metrics" actions={onVideo("vmaf")}>
            <dl>
              <Term name="VMAF">
                <p>
                  Full-reference score from 0 to 100 (model vmaf_v0.6.1). Ladders are derived and
                  compared on the harmonic mean over frames, which weighs bad passages more than the
                  arithmetic mean.
                </p>
              </Term>
              <Term name="VMAF NEG">
                <p>The no-enhancement-gain model: sharpening or added contrast earns no credit.</p>
              </Term>
              <Term name="CAMBI">
                <p>No-reference banding detector, 0 is none. Higher is more visible banding.</p>
              </Term>
              <Term name="BD-rate and BD-VMAF">
                <p>
                  The mean difference between two rate–quality curves over the range where both are
                  defined, fitted with Akima interpolation (PCHIP where Akima is not monotone).
                  BD-rate is the bitrate change at equal quality, negative is a saving; BD-VMAF the
                  quality change at equal bitrate.
                </p>
              </Term>
              <Term name="Delivered VMAF">
                <p>
                  For a playback run, the harmonic VMAF of each rung played, weighted by how long it
                  played. Steady state leaves out the first 6 s segment.
                </p>
              </Term>
            </dl>
          </Section>

          <Section id="delivery" title="Delivery and ABR">
            <dl>
              <Term name="HLS and DASH">
                <p>
                  Both carry the same encoded renditions of each ladder as fMP4 segments; they
                  differ in packaging and manifest (.m3u8 against .mpd). HLS plays through hls.js,
                  DASH through dash.js.
                </p>
              </Term>
              <Term name="Progressive">
                <p>The source file over HTTP range requests: one quality, no ladder.</p>
              </Term>
              <Term name="ABR rules">
                <p>
                  Implemented in this project and plugged into both players, so a rule behaves the
                  same over HLS and DASH. Below 4 s of buffer the three adaptive rules drop to the
                  bottom rung.
                </p>
                <DataTable headers={["Rule", "Decision"]}>
                  {ABR_RULES.map((row) => (
                    <DataRow key={row.rule}>
                      <DataCell mono={false} className="font-medium whitespace-nowrap">
                        {row.rule}
                      </DataCell>
                      <DataCell mono={false} last>
                        {row.how}
                      </DataCell>
                    </DataRow>
                  ))}
                </DataTable>
              </Term>
            </dl>
          </Section>

          <Section id="networks" title="Network profiles">
            <p className="text-sm text-muted-foreground">
              The server shapes every request of a run. Loss is emulated by its cost, an extra round
              trip that holds back the data behind it, since a server cannot drop TCP segments.
            </p>
            <DataTable
              head={
                <tr className="border-b border-foreground/20">
                  <DataHead>Profile</DataHead>
                  <DataHead numeric>Rate (Mb/s)</DataHead>
                  <DataHead numeric>Round trip</DataHead>
                  <DataHead numeric>Loss</DataHead>
                </tr>
              }
            >
              {NETWORKS.map((row) => (
                <DataRow key={row.profile}>
                  <DataCell mono={false}>{NETWORK_PROFILE_SHORT[row.profile]}</DataCell>
                  <DataCell numeric>{row.rate}</DataCell>
                  <DataCell numeric>{row.rtt}</DataCell>
                  <DataCell numeric last>
                    {row.loss}
                  </DataCell>
                </DataRow>
              ))}
            </DataTable>
            <p className="text-sm text-muted-foreground">
              Variable:{" "}
              {VARIABLE_NETWORK_SCHEDULE.map(
                (phase) => `${NETWORK_PROFILE_SHORT[phase.profile]} from ${phase.fromMs / 1000} s`,
              ).join(", ")}
              , counted from the play request. Every run is repeated three times; tables show the
              mean over the runs that started.
            </p>
          </Section>

          <Section id="browser" title="This browser">
            <p className="text-sm text-muted-foreground">
              Best mode picks the delivery from what the browser supports. It also starts on the top
              rung until the first segment arrives, which the measured runs do not.
            </p>
            <BrowserCapabilities />
          </Section>
        </div>
      </div>
    </PageShell>
  );
}
