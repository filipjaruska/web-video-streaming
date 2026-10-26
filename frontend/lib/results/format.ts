/** Number formatting for the results tables, at the precision the thesis reports each figure. */

const DASH = "—";

export function fixed(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? DASH : value.toFixed(digits);
}

/** A delta keeps its sign, so +0.42 reads as a change rather than a score. */
export function signed(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) {
    return DASH;
  }
  const text = value.toFixed(digits);
  // −0.00 and 0.00 both read as no change.
  if (Number(text) === 0) {
    return (0).toFixed(digits);
  }
  return value > 0 ? `+${text}` : text.replace("-", "−");
}

export function percent(fraction: number | null | undefined, digits = 1): string {
  return fraction == null || !Number.isFinite(fraction)
    ? DASH
    : `${(fraction * 100).toFixed(digits)} %`;
}

export function multiple(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? DASH : `${value.toFixed(2)}×`;
}

/** Values the thesis reports as "< 0.01" rather than rounding them to zero. */
export function small(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) {
    return DASH;
  }
  const threshold = 10 ** -digits;
  return Math.abs(value) < threshold ? `< ${threshold.toFixed(digits)}` : value.toFixed(digits);
}

/**
 * The name a clip goes by in tables and graphs. Catalogue titles are often file names
 * ("frieren_s01e06_t0738-0808"); the series part reads like the thesis ("Frieren").
 */
export function clipName(title: string): string {
  const name = title.split(/[_.]/)[0].replace(/-/g, " ").trim();
  return name ? name.replace(/\b\w/g, (letter) => letter.toUpperCase()) : title;
}

/** "throughput / hybrid" or "HLS / DASH" pairs in one cell. */
export function pair(a: string, b: string): string {
  return `${a} / ${b}`;
}
