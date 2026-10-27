import * as React from "react";

import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The one headline-number tile. `tone` is passed by the caller because "is this good?" is not
 * readable from the sign: a negative BD-rate is a saving, a negative ΔVMAF a regression.
 */
export type MetricTone = "neutral" | "good" | "bad";

const TONE_CLASS: Record<MetricTone, string> = {
  neutral: "",
  good: "text-success",
  bad: "text-warning",
};

export function MetricTile({
  value,
  label,
  unit,
  tone = "neutral",
  title,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  unit?: React.ReactNode;
  tone?: MetricTone;
  /** Shown as a tooltip on the label. */
  title?: React.ReactNode;
}) {
  const labelNode = (
    <div
      className={cn(
        "text-xs text-muted-foreground",
        title && "w-fit cursor-help underline decoration-dotted underline-offset-4",
      )}
      tabIndex={title ? 0 : undefined}
    >
      {label}
    </div>
  );

  return (
    <div className="min-w-0 border-l-2 border-border pl-3">
      {title ? <Hint content={title}>{labelNode}</Hint> : labelNode}
      <div className={cn("mt-1 text-2xl font-semibold tracking-tight tabular", TONE_CLASS[tone])}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

export function MetricTileGrid({
  children,
  columns = 3,
  className,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-6 gap-y-5",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-2 sm:grid-cols-3",
        columns === 4 && "grid-cols-2 lg:grid-cols-4",
        columns === 5 && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Lower is better, so a negative delta is good. */
export function toneForSaving(value: number | null | undefined): MetricTone {
  if (value == null || !Number.isFinite(value)) {
    return "neutral";
  }

  return value < 0 ? "good" : "bad";
}

/** Higher is better, so a positive delta is good. */
export function toneForGain(value: number | null | undefined): MetricTone {
  if (value == null || !Number.isFinite(value)) {
    return "neutral";
  }

  return value > 0 ? "good" : "bad";
}
