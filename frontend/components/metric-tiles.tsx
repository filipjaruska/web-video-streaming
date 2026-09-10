import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The headline-number tile used across the results views.
 *
 * `tone` exists because "is this number good?" is not inferable from the number: a negative
 * BD-rate is a saving, a negative ΔVMAF is a regression. The caller knows the direction, so it
 * passes it rather than the tile guessing from the sign.
 */
export type MetricTone = "neutral" | "good" | "bad";

const TONE_CLASS: Record<MetricTone, string> = {
  neutral: "",
  good: "text-emerald-600 dark:text-emerald-400",
  bad: "text-amber-600 dark:text-amber-400",
};

export function MetricTile({
  value,
  label,
  tone = "neutral",
  title,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  tone?: MetricTone;
  title?: string;
}) {
  return (
    <div title={title}>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums",
          TONE_CLASS[tone],
        )}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function MetricTileGrid({
  children,
  columns = 3,
  className,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Convenience for the common case: lower is better, so a negative delta is good. */
export function toneForSaving(value: number | null | undefined): MetricTone {
  if (value == null || !Number.isFinite(value)) {
    return "neutral";
  }

  return value < 0 ? "good" : "bad";
}

/** Convenience for the opposite case: higher is better, so a positive delta is good. */
export function toneForGain(value: number | null | undefined): MetricTone {
  if (value == null || !Number.isFinite(value)) {
    return "neutral";
  }

  return value > 0 ? "good" : "bad";
}
