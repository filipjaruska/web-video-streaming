import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The three packaging runs, in the order the pipeline produces them.
 *
 * Splitting into three rather than two is what lets the measurements separate the benefit of
 * content adaptation from the benefit of codec tuning; folded into one run they would be
 * indistinguishable.
 */
const LADDERS = [
  {
    name: "Static",
    role: "Baseline",
    detail:
      "A fixed table of five rungs, identical for every clip. This is what generic streaming configurations ship, and what everything else is measured against.",
  },
  {
    name: "Dynamic",
    role: "Content-adaptive",
    detail:
      "Derived per clip from a sweep of trial encodes: the convex hull of quality against log-bitrate, with one rung per resolution taken at a shared slope λ. A curve that saturates early stops early and lands cheap.",
  },
  {
    name: "Animation-tuned",
    role: "Content-adaptive + tuned",
    detail:
      "The same derivation re-run under x264's animation tune, with CAMBI subtracted from the decision score so banding on flat gradients costs a candidate something — the artifact class VMAF scarcely registers.",
  },
];

export function HomeHero() {
  return (
    <section className="mb-10 space-y-6">
      <div className="max-w-3xl space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">
          What this measures
        </h2>
        <p className="text-sm text-muted-foreground">
          Streaming ladders are usually derived from live-action assumptions. Animation breaks
          those assumptions: flat cel-shaded areas, sharp edges and frames held on twos compress
          very differently, so a generic ladder tends to overpay. This harness packages the same
          source three ways, delivers each over both HLS and DASH under interchangeable ABR rules,
          and measures what actually changed — in encoded quality and in playback behaviour.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {LADDERS.map((ladder) => (
          <Card key={ladder.name}>
            <CardHeader className="pb-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {ladder.role}
              </div>
              <CardTitle className="text-base">{ladder.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{ladder.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/results">Cross-clip results</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/concepts">How it works</Link>
        </Button>
      </div>
    </section>
  );
}
