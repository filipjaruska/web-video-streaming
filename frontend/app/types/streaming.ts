export type StreamingMethod = "http-range" | "hls" | "dash";

export type AbrAlgorithm = "throughput" | "buffer" | "hybrid" | "baseline";

export interface StreamingConfig {
  method: StreamingMethod;
  algorithm: AbrAlgorithm;
  apiUrl: string;
  videoFileName: string;
}
