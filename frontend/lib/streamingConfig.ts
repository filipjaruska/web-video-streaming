import Hls from "hls.js";
import type { AbrAlgorithm } from "@/types/streaming";

export function createHlsConfig(
  abrAlgorithm: AbrAlgorithm,
): Partial<Hls["config"]> {
  const baseConfig: Partial<Hls["config"]> = {
    debug: false,
    enableWorker: true,
    lowLatencyMode: false,
    autoStartLoad: false,
  };

  switch (abrAlgorithm) {
    case "baseline": // Non-Adaptive: Force highest quality, disable adaptive streaming
      return {
        ...baseConfig,
        startLevel: -1,
        capLevelToPlayerSize: false,
      };

    case "throughput": // Throughput-based only
      return {
        ...baseConfig,
        abrEwmaDefaultEstimate: 500000, // Start conservative
        abrBandWidthFactor: 0.95, // Aggressive bandwidth factor
        abrBandWidthUpFactor: 0.7, // Slower to upgrade quality
      };

    case "buffer": // Buffer-based: make decisions based on buffer occupancy
      return {
        ...baseConfig,
        abrEwmaDefaultEstimate: 500000,
        maxBufferLength: 30, // Target buffer length
        maxMaxBufferLength: 60,
      };

    case "hybrid": // Hybrid (Default): Dynamic strategy combining multiple factors
    default:
      return {
        ...baseConfig,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.95,
        maxBufferLength: 30,
      };
  }
}
export interface DashSettings {
  streaming?: {
    abr?: {
      rules?: {
        throughputRule?: {
          active?: boolean;
        };
        bolaRule?: {
          active?: boolean;
        };
        insufficientBufferRule?: {
          active?: boolean;
        };
      };
      autoSwitchBitrate?: {
        video?: boolean;
        audio?: boolean;
      };
    };
    buffer?: {
      fastSwitchEnabled?: boolean;
    };
  };
}

export function createDashSettings(abrAlgorithm: AbrAlgorithm): DashSettings {
  switch (abrAlgorithm) {
    case "throughput": // Throughput-based only
      return {
        streaming: {
          abr: {
            rules: {
              throughputRule: {
                active: true,
              },
              bolaRule: {
                active: false,
              },
            },
          },
          buffer: {
            fastSwitchEnabled: false,
          },
        },
      };

    case "buffer": // Buffer-Based (BOLA): Buffer Occupancy based Lyapunov Algorithm
      return {
        streaming: {
          abr: {
            rules: {
              throughputRule: {
                active: false,
              },
              bolaRule: {
                active: true,
              },
            },
          },
          buffer: {
            fastSwitchEnabled: false,
          },
        },
      };

    case "baseline": // Non-Adaptive: disable adaptive streaming, force highest quality
      return {
        streaming: {
          abr: {
            autoSwitchBitrate: {
              video: false,
              audio: false,
            },
          },
          buffer: {
            fastSwitchEnabled: false,
          },
        },
      };

    case "hybrid": // Hybrid (Default): Dynamic strategy combining multiple factors
    default:
      return {
        streaming: {
          abr: {
            rules: {
              throughputRule: {
                active: true,
              },
              bolaRule: {
                active: true,
              },
            },
          },
          buffer: {
            fastSwitchEnabled: false,
          },
        },
      };
  }
}
