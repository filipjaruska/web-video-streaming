"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PLACEHOLDER_CLIPS = [
  "Frieren",
  "Owarimonogatari",
  "Tatami Galaxy",
  "[working title]",
];

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
 * Boilerplate for thesis chapter 5.1.3 — codec tuning impact on animated
 * content (default x264 vs `--tune animation`). The comparison encode does
 * not exist yet (see 4.3.1.3 / 4.4.3), so this renders the finalized table
 * and chart structure with empty values rather than fabricated numbers.
 */
export function TuningComparisonCard() {
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
                Thesis §4.4.3 / §5.1.3 — isolates the effect of x264 codec
                tuning by holding the clip and ladder rung constant and
                varying only the encoder tune.
              </CardDescription>
            </div>
            <Badge variant="secondary">Not implemented</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Both packaging runs (static and dynamic ladder) currently encode
            with plain <code className="font-mono text-xs">libx264</code> at
            the <code className="font-mono text-xs">medium</code> preset and
            no explicit <code className="font-mono text-xs">-tune</code>{" "}
            value. A second encode variant using{" "}
            <code className="font-mono text-xs">-tune animation</code> (or an
            equivalent manual <code className="font-mono text-xs">-deblock</code>/
            <code className="font-mono text-xs">-psy-rd</code> combination)
            does not exist yet, so this tab has no per-video data to show.
          </p>
          <p>
            Once available, the metric is VMAF difference at matched bitrate
            for the same clip and ladder rung. The expected pattern is that
            the benefit of tuning shrinks as a clip&apos;s SI/TI rises, since
            the tune mainly helps flat areas with sharp edges — clips with a
            larger share of such areas should benefit the most.
          </p>
        </CardContent>
      </Card>

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
                <p className="text-sm text-muted-foreground">
                  {effect.detail}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Tabulka 12 — ΔVMAF at equal bitrate
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
          <CardTitle className="text-base">
            Graf 4 — ΔVMAF per clip
          </CardTitle>
          <CardDescription>
            Bar chart of the VMAF difference (default vs. tuned) for each
            clip, one bar per clip.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-45 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
            No tuning measurements yet.
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Table 12 aggregates ΔVMAF across all four test clips, while this page
        is scoped to a single video. Once the tuned encode variant lands,
        this tab will show this video&apos;s own default-vs-tuned VMAF series
        alongside its row in the aggregate table, mirroring the Quality
        tests tab&apos;s packaged-ladder VMAF summary.
      </p>
    </div>
  );
}
