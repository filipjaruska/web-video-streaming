"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TuningComparisonDocument } from "@/lib/videoAnalysisApi";

const PLACEHOLDER_CLIPS = [
  "Frieren",
  "Owarimonogatari",
  "Tatami Galaxy",
  "[working title]",
];

function signed(value: number | undefined, digits = 2) {
  if (value == null) {
    return "—";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

const TUNE_ANIMATION_EFFECTS = [
  {
    title: "Deblocking strength",
    detail:
      "Reduced, so flat-colored areas with sharp cel-shaded edges keep their crispness instead of being softened.",
  },
  {
    title: "Psy-RD (psychovisual optimization)",
    detail:
      "Retuned toward detail preservation on flat regions, at the cost of some rate-distortion efficiency measured by simple metrics.",
  },
  {
    title: "Ringing / mosquito noise",
    detail:
      "Targeted for suppression around thin outlines, a common artifact class on line-art-heavy animated content.",
  },
];

/**
 * Boilerplate— codec tuning impact on animated
 * content (default x264 vs `--tune animation`). The comparison encode does
 * not exist yet, so this renders the finalized table
 * and chart structure with empty values rather than fabricated numbers.
 */
export function TuningComparisonCard({
  tuning,
}: {
  tuning?: TuningComparisonDocument;
}) {
  const pairs = tuning?.pairs ?? [];
  const ready = !!tuning && !tuning.error && pairs.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                Codec tuning for animated content
              </CardTitle>
              <CardDescription>
                Isolates the effect of x264 codec tuning by holding the source
                excerpt, resolution and CRF constant and varying only the
                encoder settings.
              </CardDescription>
            </div>
            <Badge variant={ready ? "outline" : "secondary"}>
              {ready ? `${pairs.length} matched samples` : "No data yet"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {ready ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {signed(tuning!.meanVmafDelta, 3)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Mean ΔVMAF (tuned − default)
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {signed(tuning!.meanCambiDelta, 3)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Mean ΔCAMBI (lower is better)
                  </div>
                </div>
                <div>
                  <div
                    className={`text-2xl font-semibold tabular-nums ${
                      (tuning!.bdRatePercent ?? 0) < 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : ""
                    }`}
                  >
                    {tuning!.bdRatePercent != null
                      ? `${signed(tuning!.bdRatePercent)}%`
                      : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    BD-rate vs default settings
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Measured with{" "}
                <code className="font-mono text-xs">-tune {tuning!.tune}</code>
                {tuning!.decimate ? " + mpdecimate" : ""}. Pairs come from the
                two encode grids, which share the same source excerpt — the
                packaged ladders differ in bitrate by construction and so could
                not hold the rung constant.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {tuning?.error ??
                "The animation-tuned encode grid has not run for this video yet."}
            </p>
          )}
        </CardContent>
      </Card>

      {ready && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Matched samples (resolution × CRF)
            </CardTitle>
            <CardDescription>
              Every grid sample present in both the default and the tuned sweep,
              so the only difference is the encoder configuration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Rung</th>
                    <th className="py-2 pr-3 font-medium">CRF</th>
                    <th className="py-2 pr-3 font-medium">Default VMAF</th>
                    <th className="py-2 pr-3 font-medium">Tuned VMAF</th>
                    <th className="py-2 pr-3 font-medium">ΔVMAF</th>
                    <th className="py-2 font-medium">ΔCAMBI</th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((pair) => (
                    <tr
                      key={`${pair.label}-${pair.crf}`}
                      className="border-b border-border/50 last:border-b-0"
                    >
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {pair.label}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {pair.crf}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {pair.baseVmaf.toFixed(2)}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {pair.tunedVmaf.toFixed(2)}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {signed(pair.vmafDelta)}
                      </td>
                      <td className="py-1.5 font-mono text-xs">
                        {pair.baseCambi != null && pair.tunedCambi != null
                          ? signed(pair.tunedCambi - pair.baseCambi)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            What <code className="font-mono text-sm">--tune animation</code>{" "}
            changes
          </CardTitle>
          <CardDescription>
            Per x264 documentation, the effects most relevant to animated
            content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {TUNE_ANIMATION_EFFECTS.map((effect) => (
              <div
                key={effect.title}
                className="border-b border-border/50 pb-3 last:border-b-0 last:pb-0"
              >
                <p className="text-sm font-medium">{effect.title}</p>
                <p className="text-sm text-muted-foreground">{effect.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Tabulka 13 — ΔVMAF at equal bitrate
          </CardTitle>
          <CardDescription>
            Default vs. tuned x264, per clip. Populated once the tuned encode
            variant exists and both are measured (§4.4.3).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Clip</th>
                  <th className="py-2 pr-3 font-medium">Default VMAF</th>
                  <th className="py-2 pr-3 font-medium">Tuned VMAF</th>
                  <th className="py-2 font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {PLACEHOLDER_CLIPS.map((clip) => (
                  <tr
                    key={clip}
                    className="border-b border-border/50 last:border-b-0"
                  >
                    <td className="py-1.5 pr-3">{clip}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">—</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">—</td>
                    <td className="py-1.5 font-mono text-xs">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Graf 5 — ΔVMAF per clip</CardTitle>
          <CardDescription>
            Bar chart of the VMAF difference (default vs. tuned) for each clip,
            one bar per clip.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-45 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
            No tuning measurements yet.
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Table 12 aggregates ΔVMAF across all four test clips, while this page is
        scoped to a single video. Once the tuned encode variant lands, this tab
        will show this video&apos;s own default-vs-tuned VMAF series alongside
        its row in the aggregate table, mirroring the Quality tests tab&apos;s
        packaged-ladder VMAF summary.
      </p>
    </div>
  );
}
