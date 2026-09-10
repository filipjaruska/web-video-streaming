import Link from "next/link";
import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataCell, DataRow, DataTable } from "@/components/ui/data-table";
import { HullDiagram } from "@/feature/concepts/hull-diagram";
import { BrowserCapabilities } from "@/feature/concepts/browser-capabilities";
import { listVideos } from "@/lib/videoApi";
import {
  getAbrDescription,
  getDashAbrDescription,
  getStreamingMethodDescription,
} from "@/lib/streamingLabels";
import { CONCEPTS_COPY } from "@/lib/siteCopy";
import type { AbrAlgorithm } from "@/types/streaming";

export const metadata: Metadata = {
  title: CONCEPTS_COPY.title,
  description: CONCEPTS_COPY.description,
};

const ABR_ALGORITHMS: AbrAlgorithm[] = [
  "throughput",
  "buffer",
  "hybrid",
  "baseline",
];

/**
 * The fixed baseline ladder, mirroring `TranscodeProfile.Default` on the backend.
 *
 * Hardcoded rather than fetched: this is the one ladder that never varies by clip, and the page
 * needs to render it even with an empty catalogue. If the backend default ever changes, this is
 * the copy to update alongside it.
 */
const STATIC_LADDER = [
  { label: "1080p", resolution: "1920×1080", bitrate: "4500 kb/s" },
  { label: "720p", resolution: "1280×720", bitrate: "2500 kb/s" },
  { label: "480p", resolution: "854×480", bitrate: "1200 kb/s" },
  { label: "360p", resolution: "640×360", bitrate: "800 kb/s" },
  { label: "240p", resolution: "426×240", bitrate: "400 kb/s" },
];

/** A concept, with somewhere in the app it can actually be seen on measured data. */
function Section({
  title,
  link,
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        {children}
        {link && (
          <p>
            <Link
              href={link.href}
              className="text-foreground underline underline-offset-4"
            >
              {link.label} →
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function ConceptsPage() {
  // Deep links point at a real clip so every "see it live" lands on measured data rather than an
  // empty state. Falls back to prose-only links when the catalogue is empty or unreachable.
  let sample: string | null = null;
  try {
    const { videos } = await listVideos();
    sample = (videos.find((video) => video.hasHls) ?? videos[0])?.routeId ?? null;
  } catch {
    sample = null;
  }

  const analysis = (tab: string) =>
    sample ? { href: `/${sample}/analysis?tab=${tab}`, label: "See it live" } : undefined;

  return (
    <PageShell
      title={CONCEPTS_COPY.title}
      description={CONCEPTS_COPY.description}
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/">Videos</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Concepts</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <Separator className="mb-6" />

      <div className="grid gap-4 @min-[1400px]/page:grid-cols-2">
        <Section
          title="Spatial and temporal information (SI / TI)"
          link={analysis("content")}
        >
          <p>
            Two numbers from ITU-T P.910 that describe how hard a clip is to encode before anything
            encodes it. SI measures edge energy within a frame; TI measures how much changes
            between consecutive frames. Live action tends to sit high on both — texture everywhere,
            camera noise, constant motion.
          </p>
          <p>
            Animation does not. Flat cel-shaded areas keep SI low, and frames held still keep TI
            near zero. That gap is the entire premise: a ladder derived from live-action
            assumptions will overpay for content that was never that expensive.
          </p>
        </Section>

        <Section title='Duplicate frames ("on twos")' link={analysis("content")}>
          <p>
            Animation is frequently drawn on twos: each image is held for two frames, so half the
            frames in a 24 fps stream are exact repeats of their predecessor. The encoder codes
            those as near-free skipped frames, which is one reason animated content compresses far
            better than its runtime suggests.
          </p>
          <p>
            It falls out of the TI series for free — a duplicate frame has zero temporal
            information — so it costs nothing extra to measure.
          </p>
        </Section>

        <Section title="The bitrate ladder" link={analysis("ladder")}>
          <p>
            A ladder is the set of quality rungs a player can choose between: each is a resolution
            paired with a bitrate. Generic ladders are fixed tables, identical for every title,
            which is convenient and — for anything that compresses unusually well or unusually
            badly — wrong.
          </p>
          <p>
            This is the static baseline every measurement is compared against. It is the same five
            rungs for every clip, regardless of what the clip contains:
          </p>
          <DataTable headers={["Rung", "Resolution", "Bitrate"]}>
            {STATIC_LADDER.map((rung) => (
              <DataRow key={rung.label}>
                <DataCell>{rung.label}</DataCell>
                <DataCell>{rung.resolution}</DataCell>
                <DataCell last>{rung.bitrate}</DataCell>
              </DataRow>
            ))}
          </DataTable>
          <p>
            The other two ladders are derived per clip — same resolutions, but the bitrates come
            out of measurement rather than a table, and a rung can be dropped entirely if a lower
            resolution already beats it at that bitrate. All three are packaged and kept, so the
            same source can be replayed on any of them without re-processing.
          </p>
        </Section>

        <Section title="Convex hull and λ" link={analysis("ladder")}>
          <p>
            Each resolution has its own rate–quality curve, measured by encoding the clip at a
            sweep of CRF values and scoring every result. Plotted against log-bitrate the curves
            are concave: quality rises quickly, then saturates.
          </p>
          <HullDiagram />
          <p>
            λ is the primary control, and in log-rate space it has a directly readable meaning:
            keep buying bits while doubling the bitrate still returns at least λ points of quality,
            and stop once it does not. Driving selection off a fixed quality target instead inverts
            this — on hard content the target is only reachable far past the point of diminishing
            returns, and the ladder dutifully pays for it.
          </p>
        </Section>

        <Section title="Resolution crossovers" link={analysis("ladder")}>
          <p>
            Where the envelope hands over from one resolution to the next. Below its crossover a
            resolution is simply the wrong choice: some lower resolution reaches the same or better
            quality at the same bitrate, so shipping the higher one spends bits for nothing.
          </p>
          <p>
            On a correctly built hull these need no search or interpolation — they are just the
            points where consecutive vertices change resolution.
          </p>
        </Section>

        <Section title="VMAF, VMAF-NEG and CAMBI" link={analysis("delivery")}>
          <p>
            VMAF is a full-reference perceptual score fusing several elementary metrics. The
            harmonic mean is used for decisions rather than the arithmetic one, because a short
            badly-degraded passage is noticed far more than it is compensated by a long good one.
          </p>
          <p>
            VMAF-NEG withholds credit for &quot;enhancement gain&quot; — sharpening or added
            contrast that raises the score without restoring anything that was in the source. CAMBI
            is different in kind: it is no-reference, and it detects banding on flat gradients, the
            artifact animation is most prone to and that VMAF scarcely registers.
          </p>
          <p>
            CAMBI enters ladder selection as a penalty rather than a threshold, because it is not
            monotonic in CRF: banding grows as quantization coarsens, then falls again once the
            gradients are destroyed entirely and replaced by blocking. A cutoff would reject a
            middling encode while admitting a visibly worse one; subtracting it keeps the ordering
            correct at every bitrate.
          </p>
        </Section>

        <Section
          title="HLS and DASH"
          link={sample ? { href: `/${sample}`, label: "Try both" } : undefined}
        >
          <p>{getStreamingMethodDescription("hls")}</p>
          <p>{getStreamingMethodDescription("dash")}</p>
          <p>
            Here they carry <em>identical encoded content</em> — the same ladders, the same
            renditions, differing only in packaging and manifest. That is what makes any measured
            difference between them attributable to delivery rather than to encoding, and what
            makes it safe to pick whichever a given browser handles best.
          </p>
        </Section>

        <Section
          title="Adaptive bitrate algorithms"
          link={sample ? { href: `/${sample}`, label: "Switch between them" } : undefined}
        >
          <p>
            The rules are implemented in this project rather than taken from the players. Neither
            library exposes a throughput-only or buffer-only mode, and their internals differ, so
            selecting each one&apos;s built-in under a shared label would measure two different
            algorithms and blame the difference on the protocol.
          </p>
          <DataTable headers={["Rule", "How it decides", "Player's own version"]}>
            {ABR_ALGORITHMS.map((algorithm) => (
              <DataRow key={algorithm}>
                <DataCell mono={false} className="capitalize">
                  {algorithm}
                </DataCell>
                <DataCell mono={false}>{getAbrDescription(algorithm)}</DataCell>
                <DataCell mono={false} last className="text-muted-foreground">
                  {getDashAbrDescription(algorithm)}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
          <p>
            Throughput gets its hysteresis from asymmetric safety factors — a rung must fit inside
            90 % of the estimate to be switched up to, but is only abandoned once it no longer fits
            inside 100 % — so a stream parked between the two thresholds stays put instead of
            oscillating. Buffer follows BOLA-BASIC, where dividing by segment size favours cheap
            rungs while the buffer is small and expensive ones once it fills. All three sit behind
            the same panic rule: below four seconds of buffer, the bottom rung is forced regardless.
          </p>
        </Section>

        <Section title="Your browser">
          <p>
            Best mode probes these capabilities and picks a protocol accordingly, rather than
            hardcoding one. The answers below are from the browser you are reading this in.
          </p>
          <BrowserCapabilities />
        </Section>
      </div>
    </PageShell>
  );
}
