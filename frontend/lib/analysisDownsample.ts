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
  return data.si.map((si, index) => ({
    frame: index,
    timeSec: data.timeSec?.[index] ?? index,
    si,
    ti: data.ti[index] ?? 0,
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
