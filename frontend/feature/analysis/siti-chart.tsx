"use client";

import * as React from "react";
import Hls from "hls.js";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalysisTreeNode, SitiSeriesData } from "@/lib/videoAnalysisApi";
import { buildSeriesPoints, downsampleSeries } from "@/lib/analysisDownsample";
import { formatSeconds } from "@/lib/analysisLabels";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  si: {
    label: "SI",
    color: "var(--chart-1)",
  },
  ti: {
    label: "TI",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

function stdDev(values: number[], average: number) {
  if (values.length === 0) {
    return 0;
  }
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

function buildStatsFromSeries(data: SitiSeriesData): AnalysisTreeNode {
  const siAvg =
    data.si.reduce((sum, value) => sum + value, 0) /
    Math.max(data.si.length, 1);
  const tiAvg =
    data.ti.reduce((sum, value) => sum + value, 0) /
    Math.max(data.ti.length, 1);
  const siMin = data.si.length ? Math.min(...data.si) : 0;
  const siMax = data.si.length ? Math.max(...data.si) : 0;
  const tiMin = data.ti.length ? Math.min(...data.ti) : 0;
  const tiMax = data.ti.length ? Math.max(...data.ti) : 0;

  const format = (value: number) =>
    value.toLocaleString("en-US", {
      maximumFractionDigits: 4,
      useGrouping: false,
    });

  return {
    id: "siti",
    label: "SI/TI Analysis",
    meta: { source: "ffmpeg-siti", status: "completed", kind: "section" },
    children: [
      { id: "siti.avg_si", label: "Average SI", value: format(siAvg) },
      { id: "siti.max_si", label: "Max SI", value: format(siMax) },
      { id: "siti.min_si", label: "Min SI", value: format(siMin) },
      {
        id: "siti.std_si",
        label: "Std dev SI",
        value: format(stdDev(data.si, siAvg)),
      },
      { id: "siti.avg_ti", label: "Average TI", value: format(tiAvg) },
      { id: "siti.max_ti", label: "Max TI", value: format(tiMax) },
      { id: "siti.min_ti", label: "Min TI", value: format(tiMin) },
      {
        id: "siti.std_ti",
        label: "Std dev TI",
        value: format(stdDev(data.ti, tiAvg)),
      },
    ],
  };
}

interface SitiChartProps {
  data?: SitiSeriesData | null;
  stats?: AnalysisTreeNode | null;
  title?: string;
  description?: string;
  /** Progressive source MP4 URL for click-to-seek scrubbing. */
  videoSrc?: string;
  /** Label above the scrubber video (e.g. "Source preview"). */
  videoLabel?: string;
}

function SitiStatsList({ node }: { node: AnalysisTreeNode }) {
  const rows =
    node.children && node.children.length > 0 ? node.children : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>{node.label}</span>
        {node.meta?.status === "failed" && (
          <Badge variant="destructive">Failed</Badge>
        )}
        {node.meta?.status === "running" && (
          <Badge variant="secondary">Running</Badge>
        )}
        {node.meta?.status === "pending" && (
          <Badge variant="outline">Pending</Badge>
        )}
      </div>
      {node.meta?.error && (
        <p className="text-sm text-destructive">{node.meta.error}</p>
      )}
      {rows && (
        <div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 border-b border-border/50 py-1.5 text-sm last:border-b-0"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="break-all font-mono text-xs">{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SitiChart({
  data,
  stats,
  title = "Spatial Information (SI) and Temporal Information (TI) analysis results",
  description = "Spatial and temporal information (ITU-T P.910) for the source video.",
  videoSrc,
  videoLabel = "Source preview",
}: SitiChartProps) {
  const hasSeries = !!data && data.si.length > 0;
  const points = React.useMemo(
    () => (hasSeries && data ? buildSeriesPoints(data) : []),
    [data, hasSeries],
  );
  const chartData = React.useMemo(
    () => downsampleSeries(points, 1500),
    [points],
  );
  const statsNode = React.useMemo(() => {
    if (stats) {
      return stats;
    }
    if (hasSeries && data) {
      return buildStatsFromSeries(data);
    }
    return null;
  }, [stats, data, hasSeries]);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const pendingSeekRef = React.useRef<number | null>(null);
  const hoverTimeRef = React.useRef<number | null>(null);
  const isPointerDownRef = React.useRef(false);
  const [scrubTime, setScrubTime] = React.useState<number | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const canScrub = Boolean(videoSrc) && hasSeries;
  const isHlsSrc = Boolean(videoSrc?.includes(".m3u8"));

  const chartMaxTime = React.useMemo(() => {
    if (chartData.length === 0) {
      return undefined;
    }
    return Math.max(...chartData.map((point) => point.timeSec));
  }, [chartData]);

  const applySeek = React.useCallback(
    (timeSec: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(timeSec)) {
        return;
      }

      const duration =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : undefined;
      // Prefer chart extent when media duration is missing/incomplete (common with progressive MP4).
      const maxTime = duration ?? chartMaxTime;
      const clamped =
        maxTime != null
          ? Math.min(Math.max(0, timeSec), maxTime)
          : Math.max(0, timeSec);

      setScrubTime(clamped);
      pendingSeekRef.current = clamped;

      if (video.readyState >= 1) {
        video.pause();
        video.currentTime = clamped;
        pendingSeekRef.current = null;
      }
    },
    [chartMaxTime],
  );

  const flushPendingSeek = React.useCallback(() => {
    const video = videoRef.current;
    const pending = pendingSeekRef.current;
    if (!video || pending == null || video.readyState < 1) {
      return;
    }
    video.pause();
    video.currentTime = pending;
    pendingSeekRef.current = null;
  }, []);

  // Attach HLS (or native) for scrub-friendly seeking; progressive MP4 often stalls mid-file.
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) {
      return;
    }

    setPreviewError(null);
    let hls: Hls | null = null;
    let cancelled = false;

    if (isHlsSrc) {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          maxBufferLength: 8,
          maxMaxBufferLength: 16,
          startLevel: 0,
        });
        hls.loadSource(videoSrc);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!cancelled) {
            flushPendingSeek();
          }
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || cancelled) {
            return;
          }
          setPreviewError(
            "HLS 360p preview unavailable. Re-upload or wait for packaging to finish.",
          );
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = videoSrc;
      } else {
        setPreviewError("HLS playback is not supported in this browser.");
      }
    } else {
      video.src = videoSrc;
    }

    return () => {
      cancelled = true;
      if (hls) {
        hls.destroy();
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [flushPendingSeek, isHlsSrc, videoSrc]);

  const timeFromChartState = React.useCallback((state: unknown): number | null => {
    const active = state as {
      activeLabel?: string | number;
      activePayload?: Array<{ payload?: { timeSec?: number } }>;
    };

    const fromPayload = active?.activePayload?.[0]?.payload?.timeSec;
    if (typeof fromPayload === "number" && Number.isFinite(fromPayload)) {
      return fromPayload;
    }

    if (active?.activeLabel != null) {
      const parsed = Number(active.activeLabel);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }, []);

  const handleMouseMove = React.useCallback(
    (state: unknown) => {
      if (!canScrub) {
        return;
      }
      const timeSec = timeFromChartState(state);
      if (timeSec == null) {
        return;
      }
      hoverTimeRef.current = timeSec;
      if (isPointerDownRef.current) {
        applySeek(timeSec);
      }
    },
    [applySeek, canScrub, timeFromChartState],
  );

  const handleClick = React.useCallback(
    (state: unknown) => {
      if (!canScrub) {
        return;
      }
      const timeSec = timeFromChartState(state) ?? hoverTimeRef.current;
      if (timeSec != null) {
        applySeek(timeSec);
      }
    },
    [applySeek, canScrub, timeFromChartState],
  );

  const handlePointerDown = React.useCallback(() => {
    if (!canScrub) {
      return;
    }
    isPointerDownRef.current = true;
    if (hoverTimeRef.current != null) {
      applySeek(hoverTimeRef.current);
    }
  }, [applySeek, canScrub]);

  const handlePointerUp = React.useCallback(() => {
    isPointerDownRef.current = false;
  }, []);

  React.useEffect(() => {
    if (!canScrub) {
      return;
    }
    const onUp = () => {
      isPointerDownRef.current = false;
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [canScrub]);

  const gradientId = React.useId().replace(/:/g, "");

  return (
    <Card className="pt-0">
      <CardHeader className="border-b py-5">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-2 pt-4 sm:px-6 sm:pt-6">
        {statsNode && <SitiStatsList node={statsNode} />}

        {videoSrc && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{videoLabel}</h3>
              {scrubTime != null && (
                <p className="font-mono text-xs text-muted-foreground">
                  {formatSeconds(scrubTime)}
                </p>
              )}
            </div>
            <div className="overflow-hidden rounded-md border bg-muted/30">
              <video
                ref={videoRef}
                muted
                playsInline
                preload="metadata"
                disablePictureInPicture
                controlsList="nodownload nofullscreen noremoteplayback"
                className="pointer-events-none mx-auto max-h-60 w-full object-contain"
                onLoadedMetadata={flushPendingSeek}
                onCanPlay={flushPendingSeek}
                onSeeked={() => {
                  const video = videoRef.current;
                  if (video) {
                    setScrubTime(video.currentTime);
                  }
                }}
              />
            </div>
            {previewError ? (
              <p className="text-xs text-destructive">{previewError}</p>
            ) : (
              canScrub && (
                <p className="text-xs text-muted-foreground">
                  Hover and click/drag the graph to scrub the preview
                  {isHlsSrc ? " (HLS 360p)" : ""}.
                </p>
              )
            )}
          </div>
        )}

        {hasSeries ? (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">SI/TI over time</h3>
            <ChartContainer
              config={chartConfig}
              className={`aspect-auto h-[280px] w-full ${canScrub ? "cursor-crosshair select-none" : ""}`}
              onPointerDown={canScrub ? handlePointerDown : undefined}
              onPointerUp={canScrub ? handlePointerUp : undefined}
            >
              <AreaChart
                data={chartData}
                onMouseMove={canScrub ? handleMouseMove : undefined}
                onClick={canScrub ? handleClick : undefined}
              >
                <defs>
                  <linearGradient
                    id={`fillSi-${gradientId}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="var(--color-si)"
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-si)"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                  <linearGradient
                    id={`fillTi-${gradientId}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="var(--color-ti)"
                      stopOpacity={0.28}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-ti)"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="timeSec"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => formatSeconds(Number(value))}
                />
                <YAxis tickLine={false} axisLine={false} width={40} />
                <ChartTooltip
                  cursor={canScrub}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        const first = payload?.[0] as
                          | { payload?: { frame?: number; timeSec?: number } }
                          | undefined;
                        const point = first?.payload;
                        if (!point) {
                          return null;
                        }
                        return `Frame ${point.frame ?? "—"} · ${formatSeconds(point.timeSec ?? 0)}`;
                      }}
                      indicator="dot"
                    />
                  }
                />
                {scrubTime != null && (
                  <ReferenceLine
                    x={scrubTime}
                    stroke="var(--foreground)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.7}
                  />
                )}
                <Area
                  dataKey="si"
                  type="monotone"
                  fill={`url(#fillSi-${gradientId})`}
                  stroke="var(--color-si)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Area
                  dataKey="ti"
                  type="monotone"
                  fill={`url(#fillTi-${gradientId})`}
                  stroke="var(--color-ti)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          </div>
        ) : (
          !statsNode && (
            <p className="text-sm text-muted-foreground">
              No SI/TI data available yet.
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
