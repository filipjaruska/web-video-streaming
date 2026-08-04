export type StreamingMethod = "source" | "hls" | "dash";

export type AbrAlgorithm = "throughput" | "buffer" | "hybrid" | "baseline";

/** Sentinel packaging-run id for original source progressive playback. */
export const SOURCE_RUN_ID = "source";

export function isSourceRun(transcodeId: string | null | undefined): boolean {
  return !transcodeId || transcodeId === SOURCE_RUN_ID;
}

export interface StreamingConfig {
  method: StreamingMethod;
  algorithm: AbrAlgorithm;
  apiUrl: string;
  routeId: string;
}

// Video Statistics Types
export interface VideoQuality {
  width: number;
  height: number;
  bitrate: number;
  label: string; // e.g., "1080p", "720p", "480p"
  codec?: string; // e.g., "avc1.64001f" (H.264), "hev1" (H.265), "vp9"
}

export interface CurrentStats {
  quality: VideoQuality | null;
  bufferLevel: number; // in seconds
  bandwidth: number; // in Mbps
  droppedFrames: number;
  totalFrames: number;
  playbackTime: number; // in seconds
  rebufferingEvents: number;
  rebufferingDuration: number; // in seconds
}

export interface AverageStats {
  avgQuality: VideoQuality | null;
  avgBufferLevel: number;
  avgBandwidth: number;
  avgDroppedFramesRate: number; // percentage
  totalRebufferingEvents: number;
  totalRebufferingDuration: number;
  totalPlaybackTime: number;
}

export interface VideoStats {
  current: CurrentStats;
  average: AverageStats;
}

export interface StatsSnapshot {
  timestamp: number;
  quality: VideoQuality | null;
  bufferLevel: number;
  bandwidth: number;
  droppedFrames: number;
  totalFrames: number;
}
