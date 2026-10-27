/**
 * Shared formatting for measurement values and ladder identity.
 *
 * Ladder kind in particular is named once here: inline two-branch ternaries would silently label
 * any third kind of ladder as "Static".
 */

/**
 * The packaging runs the pipeline produces. Mirrors `LadderKind` on the backend as emitted by
 * `AnalysisTargetBuilder.LadderToken` — note the token is `"animation"`, not `"animationTuned"`.
 */
export type LadderKind = "static" | "dynamic" | "animation";

const LADDER_KINDS: readonly LadderKind[] = ["static", "dynamic", "animation"];

/** Narrows an arbitrary server string, so an unknown ladder renders as itself rather than as "Static". */
export function isLadderKind(value: string | null | undefined): value is LadderKind {
  return typeof value === "string" && (LADDER_KINDS as readonly string[]).includes(value);
}

/** Short form for badges and table cells, in the thesis's terms. */
export function ladderLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "static":
      return "Static";
    case "dynamic":
      return "Content-adaptive";
    case "animation":
      return "Animation-optimised";
    case "source":
      return "Source";
    default:
      return kind ?? "Unknown";
  }
}

/** Long form for headings. */
export function ladderLongLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "static":
      return "Static ladder";
    case "dynamic":
      return "Content-adaptive ladder";
    case "animation":
      return "Animation-optimised ladder";
    case "source":
      return "Source file";
    default:
      return kind ?? "Unknown ladder";
  }
}

/** The CSS colour of a ladder, the same in every chart, table and badge. */
export function ladderColor(kind: string | null | undefined): string {
  switch (kind) {
    case "static":
      return "var(--ladder-static)";
    case "dynamic":
      return "var(--ladder-dynamic)";
    case "animation":
      return "var(--ladder-animation)";
    default:
      return "var(--protocol-source)";
  }
}

/**
 * Keeps the sign on a delta. A bare `0.42` reads as an absolute score; `+0.42` reads as a change,
 * which is what every comparison in this app reports.
 */
export function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

/** Bitrate in Mb/s, the one unit every rate in the app and the thesis is given in. */
export function formatBitrate(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) {
    return "—";
  }

  return `${(bps / 1_000_000).toFixed(2)} Mb/s`;
}

/** Percentage with a fixed precision, or an em dash when the value was never measured. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }

  return `${(value * 100).toFixed(digits)} %`;
}

/** Plain number, or an em dash. Used wherever a metric may be absent on older analyses. */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }

  return value.toFixed(digits);
}

/** Seconds as `m:ss`, for durations read off timestamps. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }

  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/**
 * Height from a `"1920:1080"` or `"1920x1080"` resolution string. Returns null rather than NaN so
 * callers can fall back instead of sorting on a silent NaN.
 */
export function parseResolutionHeight(resolution: string | null | undefined): number | null {
  if (!resolution) {
    return null;
  }

  const parts = resolution.split(/[:xX]/);
  if (parts.length < 2) {
    return null;
  }

  const height = Number.parseInt(parts[1], 10);
  return Number.isFinite(height) ? height : null;
}

/** Formats a resolution for display: `1920:1080` → `1920×1080`. */
export function formatResolution(resolution: string | null | undefined): string {
  return resolution ? resolution.replace(/[:xX]/, "×") : "—";
}
