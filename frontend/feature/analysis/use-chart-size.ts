"use client";

import * as React from "react";

export interface ChartSize {
  width: number;
  height: number;
}

/**
 * Gates a chart on a real measured size.
 *
 * Recharts' `ResponsiveContainer` mounts at 0×0 inside a `Card` in a grid, or inside an inactive
 * tab panel, and either warns loudly or renders nothing at all. Every chart in this app therefore
 * waits for a non-zero measurement before mounting. Returns null until one arrives.
 *
 * Usage: spread `ref` onto the sizing element, and render the chart only once `size` is non-null.
 */
export function useChartSize<T extends HTMLElement = HTMLDivElement>(): {
  ref: React.RefObject<T | null>;
  size: ChartSize | null;
} {
  const ref = React.useRef<T>(null);
  const [size, setSize] = React.useState<ChartSize | null>(null);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}
