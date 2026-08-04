export interface SeriesPoint {
  frame: number;
  timeSec: number;
  si: number;
  ti: number;
}

export interface VmafPoint {
  frame: number;
  timeSec: number;
  vmaf: number;
}

export function downsampleSeries(
  points: SeriesPoint[],
  maxPoints = 1500,
): SeriesPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = points.length / maxPoints;
  const result: SeriesPoint[] = [];

  for (let i = 0; i < maxPoints; i++) {
    const index = Math.min(points.length - 1, Math.floor(i * step));
    result.push(points[index]);
  }

  return result;
}

export function downsampleVmafSeries(
  points: VmafPoint[],
  maxPoints = 1500,
): VmafPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = points.length / maxPoints;
  const result: VmafPoint[] = [];

  for (let i = 0; i < maxPoints; i++) {
    const index = Math.min(points.length - 1, Math.floor(i * step));
    result.push(points[index]);
  }

  return result;
}

export function buildSeriesPoints(data: {
  si: number[];
  ti: number[];
  timeSec?: number[];
}): SeriesPoint[] {
  const count = data.si.length;
  const times = data.timeSec;
  const hasAlignedTimes =
    Array.isArray(times) &&
    times.length === count &&
    times.every((value) => Number.isFinite(value));

  // ffprobe sometimes omits pts — frontend used to fall back to frame index,
  // which makes a 10s clip look like minutes on the axis and breaks scrubbing.
  const looksLikeFrameIndex =
    hasAlignedTimes &&
    count > 2 &&
    Math.abs(times![0]!) < 1 &&
    Math.abs(times![count - 1]! - (count - 1)) <= Math.max(2, count * 0.01);

  return data.si.map((si, index) => ({
    frame: index,
    timeSec:
      hasAlignedTimes && !looksLikeFrameIndex
        ? times![index]!
        : count <= 1
          ? 0
          : index / (count - 1),
    si,
    ti: data.ti[index] ?? 0,
  }));
}

/** When SI/TI times are normalized 0..1 (no pts), scale onto real media duration. */
export function scaleSeriesToDuration(
  points: SeriesPoint[],
  durationSec: number,
): SeriesPoint[] {
  if (
    points.length === 0 ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0
  ) {
    return points;
  }

  const maxT = Math.max(...points.map((point) => point.timeSec));
  // Already absolute seconds (roughly matching the media).
  if (maxT > 1.5 && Math.abs(maxT - durationSec) / durationSec < 0.25) {
    return points;
  }
  // Unit interval (or other normalized) → wall-clock seconds.
  if (maxT <= 1.5) {
    return points.map((point) => ({
      ...point,
      timeSec: point.timeSec * durationSec,
    }));
  }

  // Frame-index-like or mismatched long axis → evenly span the media.
  const last = Math.max(points.length - 1, 1);
  return points.map((point, index) => ({
    ...point,
    timeSec: (index / last) * durationSec,
  }));
}

export function buildVmafPoints(data: {
  scores: number[];
  timeSec?: number[];
}): VmafPoint[] {
  return data.scores.map((vmaf, index) => ({
    frame: index,
    timeSec: data.timeSec?.[index] ?? index,
    vmaf,
  }));
}
