/** Round-number ticks for a log-scaled bitrate axis in Mb/s: 0.1, 0.2, 0.5, 1, 2, 5, 10 … */
const STEPS = [1, 2, 5];

export function logDomain(values: number[]): [number, number] {
  const positive = values.filter((value) => value > 0 && Number.isFinite(value));
  if (positive.length === 0) {
    return [0.1, 10];
  }
  // A little headroom either side, so the end points do not sit on the plot edge.
  return [Math.min(...positive) / 1.15, Math.max(...positive) * 1.15];
}

export function logTicks([low, high]: [number, number]): number[] {
  const ticks: number[] = [];
  for (
    let exponent = Math.floor(Math.log10(low));
    exponent <= Math.ceil(Math.log10(high));
    exponent++
  ) {
    for (const step of STEPS) {
      const tick = step * 10 ** exponent;
      if (tick >= low && tick <= high) {
        ticks.push(Number(tick.toPrecision(3)));
      }
    }
  }
  return ticks;
}

export function formatMbpsTick(value: number): string {
  return value >= 1 ? String(value) : value.toFixed(value >= 0.1 ? 1 : 2);
}
