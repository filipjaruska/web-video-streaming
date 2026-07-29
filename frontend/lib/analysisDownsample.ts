export interface SeriesPoint {
  frame: number;
  timeSec: number;
  si: number;
  ti: number;
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
