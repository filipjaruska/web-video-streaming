/**
 * Shared formatting for measurement values and ladder identity.
 *
 * Ladder kind in particular used to be inlined as two-branch ternaries in four places, which
 * silently mislabelled the animation-tuned ladder as "Static" once the pipeline grew a third
 * packaging run. Naming the vocabulary once means a fourth ladder cannot repeat that.
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

/** Short form for badges and table cells. */
export function ladderLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "static":
      return "Static";
    case "dynamic":
      return "Dynamic";
    case "animation":
      return "Animation-tuned";
    case "source":
      return "Source";
    default:
      return kind ?? "Unknown";
  }
}

/** Long form, matching `AnalysisTargetBuilder.LadderLabel` on the backend. */
export function ladderLongLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "static":
      return "Static ladder";
    case "dynamic":
      return "Dynamic ladder (VMAF crossover)";
    case "animation":
      return "Animation-tuned ladder";
    case "source":
      return "Source (original)";
    default:
      return kind ?? "Unknown ladder";
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

/** Bitrate in the unit that keeps it readable: Mb/s above 1 Mb/s, kb/s below. */
export function formatBitrate(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) {
    return "—";
  }

  return bps >= 1_000_000
    ? `${(bps / 1_000_000).toFixed(2)} Mb/s`
    : `${Math.round(bps / 1000)} kb/s`;
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
