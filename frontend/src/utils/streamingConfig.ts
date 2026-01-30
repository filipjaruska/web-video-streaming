import Hls from "hls.js";
import type { AbrAlgorithm } from "../types/streaming";

/**
 * HLS Configuration Factory
 * Creates HLS.js configuration based on the selected ABR algorithm
 */
export function createHlsConfig(
  abrAlgorithm: AbrAlgorithm,
): Partial<Hls["config"]> {
  const baseConfig: Partial<Hls["config"]> = {
    debug: false,
    enableWorker: true,
    lowLatencyMode: false,
  };

  switch (abrAlgorithm) {
    case "baseline":
      // Force highest quality, disable adaptive streaming
      return {
        ...baseConfig,
        startLevel: -1, // Start with highest
        capLevelToPlayerSize: false,
      };

    case "throughput":
      // Throughput-based (legacy): primarily based on bandwidth estimation
      return {
        ...baseConfig,
        abrEwmaDefaultEstimate: 500000, // Start conservative
        abrBandWidthFactor: 0.95, // Aggressive bandwidth factor
        abrBandWidthUpFactor: 0.7, // Slower to upgrade quality
      };

    case "buffer":
      // Buffer-based: make decisions based on buffer occupancy
      return {
        ...baseConfig,
        abrEwmaDefaultEstimate: 500000,
        maxBufferLength: 30, // Target buffer length
        maxMaxBufferLength: 60,
      };

    case "hybrid":
    default:
      // Hybrid (default): balanced approach
      return {
        ...baseConfig,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.95,
        maxBufferLength: 30,
      };
  }
}

/**
 * DASH Configuration Factory
 * Creates dash.js settings based on the selected ABR algorithm
 */
export interface DashSettings {
  streaming?: {
    abr?: {
      useDefaultABRRules?: boolean;
      ABRStrategy?: string;
      autoSwitchBitrate?: {
        video?: boolean;
        audio?: boolean;
      };
    };
  };
}

export function createDashSettings(abrAlgorithm: AbrAlgorithm): DashSettings {
  switch (abrAlgorithm) {
    case "throughput":
      return {
        streaming: {
          abr: {
            useDefaultABRRules: true,
            ABRStrategy: "abrThroughput", // Throughput-based only
          },
        },
      };

    case "buffer":
      return {
        streaming: {
          abr: {
            useDefaultABRRules: true,
            ABRStrategy: "abrBola", // BOLA - Buffer Occupancy based
          },
        },
      };

    case "baseline":
      // Baseline: disable adaptive streaming, force highest quality
      return {
        streaming: {
          abr: {
            autoSwitchBitrate: {
              video: false,
              audio: false,
            },
          },
        },
      };

    case "hybrid":
    default:
      // Hybrid (default): Dynamic strategy combining multiple factors
      return {
        streaming: {
          abr: {
            useDefaultABRRules: true,
            ABRStrategy: "abrDynamic", // Default hybrid approach
          },
        },
      };
  }
}
