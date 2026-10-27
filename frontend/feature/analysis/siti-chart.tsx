"use client";

import * as React from "react";
import type Hls from "hls.js";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import type { AnalysisTreeNode, SitiSeriesData } from "@/lib/videoAnalysisApi";
import {
  buildSeriesPoints,
  downsampleSeries,
  scaleSeriesToDuration,
} from "@/lib/analysisDownsample";
import { formatSeconds } from "@/lib/analysisLabels";
import { slugFilename } from "@/lib/csvExport";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Figure } from "@/components/figure";
import { StatusBadge } from "@/components/status-badge";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  si: { label: "SI", color: "var(--chart-1)" },
  ti: { label: "TI", color: "var(--chart-2)" },
} satisfies ChartConfig;

/**
 * Population standard deviation (÷n), deliberately not the sample form (n−1) used by
 * `summarize` in `lib/benchmark/metrics.ts`.
 *
 * SI/TI is computed over every frame of the video, so the frames are the whole population — there
 * is nothing being sampled. Benchmark repetitions, by contrast, are a sample drawn from the runs
 * that could have happened, hence n−1 there. Both halves match their backend counterparts
 * (`SitiAnalyzer.ComputeStats` and `PlaybackBenchmarkStore`), so unifying them would silently
 * desynchronise the frontend from the numbers the backend reports.
 */
function stdDev(values: number[], average: number) {
  if (values.length === 0) {
    return 0;
  }
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function format(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 4,
    useGrouping: false,
  });
}

function buildStatsFromSeries(data: SitiSeriesData): AnalysisTreeNode {
  const siAvg = data.si.reduce((sum, value) => sum + value, 0) / Math.max(data.si.length, 1);
  const tiAvg = data.ti.reduce((sum, value) => sum + value, 0) / Math.max(data.ti.length, 1);
  const siMin = data.si.length ? Math.min(...data.si) : 0;
  const siMax = data.si.length ? Math.max(...data.si) : 0;
  const tiMin = data.ti.length ? Math.min(...data.ti) : 0;
  const tiMax = data.ti.length ? Math.max(...data.ti) : 0;

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
  /** Line under the chart: what was measured and how. */
  note?: string;
  /** The min/max/SD list; off where the same figures are already shown as tiles. */
  showStats?: boolean;
  /** Progressive source MP4 URL for click-to-seek scrubbing. */
  videoSrc?: string;
  /** Label above the scrubber video (e.g. "Source preview"). */
  videoLabel?: string;
}

function SitiStatsList({ node }: { node: AnalysisTreeNode }) {
  const rows = node.children && node.children.length > 0 ? node.children : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>{node.label}</span>
        {node.meta?.status && node.meta.status !== "completed" && (
          <StatusBadge status={node.meta.status} />
        )}
      </div>
      {node.meta?.error && <p className="text-sm text-destructive">{node.meta.error}</p>}
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
  title = "SI and TI over time",
  note = "ITU-T P.910, per frame of the source.",
  showStats = true,
  videoSrc,
  videoLabel = "Preview",
}: SitiChartProps) {
  const hasSeries = !!data && data.si.length > 0;
  const [mediaDuration, setMediaDuration] = React.useState<number | null>(null);

  const points = React.useMemo(() => {
    if (!hasSeries || !data) {
      return [];
    }
    const raw = buildSeriesPoints(data);
    return mediaDuration != null ? scaleSeriesToDuration(raw, mediaDuration) : raw;
  }, [data, hasSeries, mediaDuration]);
  const chartData = React.useMemo(() => downsampleSeries(points, 1500), [points]);
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
  const hlsRef = React.useRef<Hls | null>(null);
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
    (chartTimeSec: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(chartTimeSec)) {
        return;
      }

      const duration =
        mediaDuration != null && mediaDuration > 0
          ? mediaDuration
          : Number.isFinite(video.duration) && video.duration > 0
            ? video.duration
            : undefined;

      const chartMax = chartMaxTime != null && chartMaxTime > 0 ? chartMaxTime : undefined;

      // Map chart X → media time. When SI/TI pts are missing, scaleSeriesToDuration has already
      // stretched frame indexes to the duration; the proportional map covers any residual mismatch.
      let seekTime = chartTimeSec;
      if (duration != null && chartMax != null) {
        const timelinesAgree = Math.abs(chartMax - duration) / Math.max(duration, 0.001) < 0.25;
        seekTime = timelinesAgree ? chartTimeSec : (chartTimeSec / chartMax) * duration;
        seekTime = Math.min(Math.max(0, seekTime), duration);
      } else if (chartMax != null) {
        seekTime = Math.min(Math.max(0, chartTimeSec), chartMax);
      } else {
        seekTime = Math.max(0, chartTimeSec);
      }

      setScrubTime(seekTime);
      pendingSeekRef.current = seekTime;

      const hls = hlsRef.current;
      if (hls) {
        try {
          hls.startLoad(seekTime);
        } catch {
          // ignore
        }
      }

      if (video.readyState >= 1) {
        video.pause();
        try {
          video.currentTime = seekTime;
        } catch {
          // pending seek flushes later
        }
      }
    },
    [chartMaxTime, mediaDuration],
  );

  const flushPendingSeek = React.useCallback(() => {
    const video = videoRef.current;
    const pending = pendingSeekRef.current;
    if (!video || pending == null || video.readyState < 1) {
      return;
    }
    video.pause();
    try {
      video.currentTime = pending;
    } catch {
      return;
    }
  }, []);

  // Attach HLS (or native) for scrub-friendly seeking; progressive MP4 often stalls mid-file.
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) {
      return;
    }

    setPreviewError(null);
    setMediaDuration(null);
    let hls: Hls | null = null;
    let cancelled = false;

    const syncDuration = () => {
      if (cancelled) {
        return;
      }
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0) {
        setMediaDuration(duration);
      }
    };

    video.addEventListener("loadedmetadata", syncDuration);
    video.addEventListener("durationchange", syncDuration);

    if (isHlsSrc) {
      // Loaded here rather than with the page: the chart is useful before the preview is.
      void import("hls.js").then(({ default: HlsLibrary }) => {
        if (cancelled) {
          return;
        }
        if (!HlsLibrary.isSupported()) {
          if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = videoSrc;
          } else {
            setPreviewError("HLS playback is not supported in this browser.");
          }
          return;
        }
        const instance = new HlsLibrary({
          enableWorker: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 120,
          maxBufferHole: 0.5,
          nudgeMaxRetry: 5,
          startFragPrefetch: true,
        });
        hls = instance;
        hlsRef.current = instance;
        instance.loadSource(videoSrc);
        instance.attachMedia(video);
        instance.on(HlsLibrary.Events.MANIFEST_PARSED, () => {
          if (!cancelled) {
            syncDuration();
            flushPendingSeek();
          }
        });
        instance.on(HlsLibrary.Events.LEVEL_LOADED, (_event, level) => {
          if (cancelled) {
            return;
          }
          const total = level.details?.totalduration;
          if (typeof total === "number" && total > 0) {
            setMediaDuration(total);
          } else {
            syncDuration();
          }
          flushPendingSeek();
        });
        instance.on(HlsLibrary.Events.ERROR, (_event, error) => {
          if (!error.fatal || cancelled) {
            return;
          }
          setPreviewError("Preview unavailable: this rung could not be loaded.");
        });
      });
    } else {
      video.src = videoSrc;
    }

    return () => {
      cancelled = true;
      hlsRef.current = null;
      video.removeEventListener("loadedmetadata", syncDuration);
      video.removeEventListener("durationchange", syncDuration);
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

  const exportRows = React.useMemo(
    () =>
      points.map((point) => [
        point.frame,
        Number(point.timeSec.toFixed(6)),
        Number(point.si.toFixed(6)),
        Number(point.ti.toFixed(6)),
      ]),
    [points],
  );

  const chart = hasSeries ? (
    <ChartContainer
      config={chartConfig}
      className={`aspect-auto h-[260px] w-full ${canScrub ? "cursor-crosshair select-none" : ""}`}
      onPointerDown={canScrub ? handlePointerDown : undefined}
      onPointerUp={canScrub ? handlePointerUp : undefined}
    >
      <AreaChart
        data={chartData}
        onMouseMove={canScrub ? handleMouseMove : undefined}
        onClick={canScrub ? handleClick : undefined}
      >
        <defs>
          <linearGradient id={`fillSi-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-si)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-si)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={`fillTi-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-ti)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--color-ti)" stopOpacity={0.02} />
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
          fontSize={12}
          tickFormatter={(value) => formatSeconds(Number(value))}
        />
        <YAxis tickLine={false} axisLine={false} width={36} fontSize={12} />
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
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <Area
          dataKey="ti"
          type="monotone"
          fill={`url(#fillTi-${gradientId})`}
          stroke="var(--color-ti)"
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  ) : (
    <p className="text-sm text-muted-foreground">No SI/TI series yet.</p>
  );

  return (
    <Figure
      title={title}
      note={note}
      actions={
        hasSeries && (
          <ExportCsvButton
            filename={slugFilename(["siti", title])}
            headers={["frame", "time_sec", "si", "ti"]}
            rows={exportRows}
          />
        )
      }
    >
      <div
        className={
          videoSrc ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]" : undefined
        }
      >
        {chart}
        {videoSrc && (
          <div className="space-y-1.5">
            <div className="overflow-hidden rounded-sm border bg-black">
              <video
                ref={videoRef}
                muted
                playsInline
                preload="auto"
                disablePictureInPicture
                controlsList="nodownload nofullscreen noremoteplayback"
                className="pointer-events-none aspect-video w-full object-contain"
                onLoadedMetadata={flushPendingSeek}
                onDurationChange={flushPendingSeek}
                onCanPlay={flushPendingSeek}
                onSeeked={() => {
                  const video = videoRef.current;
                  if (!video) {
                    return;
                  }
                  const pending = pendingSeekRef.current;
                  if (pending != null && Math.abs(video.currentTime - pending) > 1.25) {
                    try {
                      hlsRef.current?.startLoad(pending);
                      video.currentTime = pending;
                    } catch {
                      // ignore
                    }
                    return;
                  }
                  pendingSeekRef.current = null;
                  setScrubTime(video.currentTime);
                }}
              />
            </div>
            <p className={`text-xs ${previewError ? "text-destructive" : "text-muted-foreground"}`}>
              {previewError ??
                (scrubTime != null
                  ? `${videoLabel} at ${formatSeconds(scrubTime)}`
                  : canScrub
                    ? "Click or drag on the graph to find a frame."
                    : videoLabel)}
            </p>
          </div>
        )}
      </div>
      {showStats && statsNode && <SitiStatsList node={statsNode} />}
    </Figure>
  );
}
