import { useState, useEffect, useRef } from 'react'
import Hls from 'hls.js'
import * as dashjs from 'dashjs'
import './App.css'

type StreamingMethod = 'http-range' | 'hls' | 'dash'
type AbrAlgorithm = 'throughput' | 'buffer' | 'hybrid' | 'baseline'

function App() {
  const API_URL = import.meta.env.VITE_API_URL
  const videoFileName = import.meta.env.VITE_VIDEO_FILE_NAME

  const [streamingMethod, setStreamingMethod] = useState<StreamingMethod>('http-range')
  const [abrAlgorithm, setAbrAlgorithm] = useState<AbrAlgorithm>('hybrid')
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null)
  const [dashInstance, setDashInstance] = useState<dashjs.MediaPlayerClass | null>(null)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!videoRef.current) return

    setError(null) // Clear any previous errors

    // Clean up any existing instances
    if (hlsInstance) {
      hlsInstance.destroy()
      setHlsInstance(null)
    }
    if (dashInstance) {
      dashInstance.reset()
      setDashInstance(null)
    }

    if (streamingMethod === 'hls') {
      if (Hls.isSupported()) {
        // Configure HLS.js based on ABR algorithm
        const hlsConfig: Partial<Hls['config']> = {
          debug: false,
          enableWorker: true,
          lowLatencyMode: false,
        }

        // Configure ABR algorithm for HLS
        if (abrAlgorithm === 'baseline') {
          // Force highest quality, disable adaptive streaming
          hlsConfig.startLevel = -1 // Start with highest
          hlsConfig.capLevelToPlayerSize = false
        } else if (abrAlgorithm === 'throughput') {
          // Throughput-based (legacy): primarily based on bandwidth estimation
          hlsConfig.abrEwmaDefaultEstimate = 500000 // Start conservative
          hlsConfig.abrBandWidthFactor = 0.95 // Aggressive bandwidth factor
          hlsConfig.abrBandWidthUpFactor = 0.7 // Slower to upgrade quality
        } else if (abrAlgorithm === 'buffer') {
          // Buffer-based: make decisions based on buffer occupancy
          hlsConfig.abrEwmaDefaultEstimate = 500000
          hlsConfig.maxBufferLength = 30 // Target buffer length
          hlsConfig.maxMaxBufferLength = 60
        } else {
          // Hybrid (default): balanced approach
          hlsConfig.abrEwmaDefaultEstimate = 500000
          hlsConfig.abrBandWidthFactor = 0.95
          hlsConfig.maxBufferLength = 30
        }

        const hls = new Hls(hlsConfig)
        // https://www.npmjs.com/package/hls.js#:~:text=hls.js%40canary-,Embedding%20HLS.js,-Directly%20include%20dist
        const hlsUrl = `${API_URL}/api/hls/${videoFileName.replace('.mp4', '')}/master.m3u8`
        hls.loadSource(hlsUrl)
        hls.attachMedia(videoRef.current)

        // If baseline mode, lock to highest quality after manifest loads
        if (abrAlgorithm === 'baseline') {
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            hls.currentLevel = hls.levels.length - 1 // Force highest quality
          })
        }

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.error('HLS error:', data)
            setError(`HLS Error: ${data.type} - ${data.details}`)
          }
        })

        setHlsInstance(hls)

        return () => {
          hls.destroy()
        }
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        videoRef.current.src = `${API_URL}/api/hls/${videoFileName.replace('.mp4', '')}/master.m3u8`
      } else {
        setError('HLS is not supported in this browser. Please use a modern browser like Google Chrome or a Chromium-based alternative.')
      }
    } else if (streamingMethod === 'dash') {
      const dash = dashjs.MediaPlayer().create()

      // Configure ABR algorithm for DASH
      interface DashSettings {
        streaming?: {
          abr?: {
            useDefaultABRRules?: boolean
            ABRStrategy?: string
            autoSwitchBitrate?: {
              video?: boolean
              audio?: boolean
            }
          }
        }
      }

      const dashSettings: DashSettings = {}

      if (abrAlgorithm === 'throughput') {
        dashSettings.streaming = {
          abr: {
            useDefaultABRRules: true,
            ABRStrategy: 'abrThroughput', // Throughput-based only
          }
        }
      } else if (abrAlgorithm === 'buffer') {
        dashSettings.streaming = {
          abr: {
            useDefaultABRRules: true,
            ABRStrategy: 'abrBola', // BOLA - Buffer Occupancy based
          }
        }
      } else if (abrAlgorithm === 'baseline') {
        // Baseline: disable adaptive streaming, force highest quality
        dashSettings.streaming = {
          abr: {
            autoSwitchBitrate: {
              video: false,
              audio: false
            }
          }
        }
      } else {
        // Hybrid (default): Dynamic strategy combining multiple factors
        dashSettings.streaming = {
          abr: {
            useDefaultABRRules: true,
            ABRStrategy: 'abrDynamic', // Default hybrid approach
          }
        }
      }

      dash.updateSettings(dashSettings)
      dash.initialize(videoRef.current, `${API_URL}/api/dash/${videoFileName.replace('.mp4', '')}/manifest.mpd`, false)

      // Note: For baseline mode, the autoSwitchBitrate: false setting above will prevent quality switching.

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dash.on(dashjs.MediaPlayer.events.ERROR, (e: any) => {
        console.error('DASH error:', e)
        setError(`DASH Error: ${e.error?.code || 'Unknown error'}`)
      })

      setDashInstance(dash)

      return () => {
        dash.reset()
      }
    } else {
      videoRef.current.src = `${API_URL}/api/httprange/${videoFileName}`
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingMethod, abrAlgorithm, API_URL, videoFileName])

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Video Streaming Comparison</h1>

      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <div style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          background: '#f8f9fa',
          borderRadius: '8px',
          border: '2px solid #dee2e6'
        }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            fontSize: '1.1rem',
            fontWeight: '600'
          }}>
            <span>Streaming Method:</span>
            <select
              value={streamingMethod}
              onChange={(e) => setStreamingMethod(e.target.value as StreamingMethod)}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '1rem',
                borderRadius: '4px',
                border: '1px solid #ced4da',
                cursor: 'pointer',
                flex: 1
              }}
            >
              <option value="http-range">HTTP Range Requests (Progressive Download)</option>
              <option value="hls">HLS (HTTP Live Streaming - Apple)</option>
              <option value="dash">DASH (Dynamic Adaptive Streaming - MPEG)</option>
            </select>
          </label>

          {(streamingMethod === 'hls' || streamingMethod === 'dash') && (
            <div style={{ marginTop: '1rem' }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                fontSize: '1rem',
                fontWeight: '600'
              }}>
                <span>ABR Algorithm:</span>
                <select
                  value={abrAlgorithm}
                  onChange={(e) => setAbrAlgorithm(e.target.value as AbrAlgorithm)}
                  style={{
                    padding: '0.5rem 1rem',
                    fontSize: '1rem',
                    borderRadius: '4px',
                    border: '1px solid #ced4da',
                    cursor: 'pointer',
                    flex: 1
                  }}
                >
                  <option value="hybrid">Hybrid (Dynamic) - Default</option>
                  <option value="throughput">Throughput-Based (Legacy)</option>
                  <option value="buffer">Buffer-Based (BOLA)</option>
                  <option value="baseline">Baseline (Non-Adaptive)</option>
                </select>
              </label>
            </div>
          )}

          <div style={{
            marginTop: '0.75rem',
            padding: '0.75rem',
            background: 'white',
            borderRadius: '4px',
            fontSize: '0.9rem',
            color: '#495057'
          }}>
            {streamingMethod === 'http-range' ? (
              <>
                <strong>📹 HTTP Range Requests:</strong> Traditional video delivery.
                Single quality, browser requests video chunks as needed.
                Simple but no quality adaptation.
              </>
            ) : streamingMethod === 'hls' ? (
              <>
                <strong>🍎 HLS (Adaptive):</strong> Apple's streaming protocol.
                Multiple quality levels, automatically adapts to network conditions.
                Used by YouTube, Twitch. Format: .m3u8 + .ts segments.
                <br />
                <span style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem', display: 'block' }}>
                  {abrAlgorithm === 'hybrid' && '🔄 Hybrid: Balances bandwidth and buffer for optimal quality'}
                  {abrAlgorithm === 'throughput' && '📊 Throughput: Quality based on network speed estimation'}
                  {abrAlgorithm === 'buffer' && '📦 BOLA: Quality based on buffer occupancy levels'}
                  {abrAlgorithm === 'baseline' && '⚡ Baseline: Locks to highest quality (may stall on slow networks)'}
                </span>
              </>
            ) : (
              <>
                <strong>🎬 DASH (Adaptive):</strong> Industry-standard streaming protocol (MPEG).
                Multiple quality levels, automatic adaptation.
                Used by Netflix, YouTube. Format: .mpd manifest + .m4s segments.
                <br />
                <span style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem', display: 'block' }}>
                  {abrAlgorithm === 'hybrid' && '🔄 Dynamic: Modern hybrid approach combining multiple factors'}
                  {abrAlgorithm === 'throughput' && '📊 Throughput: Quality based on network speed only'}
                  {abrAlgorithm === 'buffer' && '📦 BOLA: Buffer Occupancy based Lyapunov Algorithm'}
                  {abrAlgorithm === 'baseline' && '⚡ Baseline: Forces highest quality (may cause buffering)'}
                </span>
              </>
            )}
          </div>
        </div>

        <video
          ref={videoRef}
          controls
          width="100%"
          style={{
            borderRadius: '8px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            background: '#000',
            display: error ? 'none' : 'block'
          }}
        >
          Your browser does not support the video tag.
        </video>

        {error && (
          <div style={{
            padding: '2rem',
            background: '#f8d7da',
            border: '2px solid #f5c2c7',
            borderRadius: '8px',
            color: '#842029',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⚠️</div>
            <div style={{ fontWeight: '600', marginBottom: '0.5rem' }}>Error</div>
            <div>{error}</div>
          </div>
        )}

        <div style={{
          marginTop: '1rem',
          padding: '0.75rem',
          background: '#e7f3ff',
          borderRadius: '8px',
          fontSize: '0.9rem',
          color: '#495057'
        }}>
          <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
            Active Method: {
              streamingMethod === 'http-range' ? 'HTTP Range Requests' :
                streamingMethod === 'hls' ? `HLS Adaptive Streaming (${getAbrLabel()})` :
                  `DASH Adaptive Streaming (${getAbrLabel()})`
            }
          </div>
          <div style={{ fontSize: '0.85rem', color: '#666' }}>
            {streamingMethod === 'http-range' ? (
              <>URL: {`${API_URL}/api/video/${videoFileName}`}</>
            ) : streamingMethod === 'hls' ? (
              <>Manifest: {`${API_URL}/api/hls/${videoFileName.replace('.mp4', '')}/master.m3u8`}</>
            ) : (
              <>Manifest: {`${API_URL}/api/dash/${videoFileName.replace('.mp4', '')}/manifest.mpd`}</>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  function getAbrLabel() {
    switch (abrAlgorithm) {
      case 'hybrid': return 'Hybrid'
      case 'throughput': return 'Throughput-Based'
      case 'buffer': return 'Buffer-Based (BOLA)'
      case 'baseline': return 'Non-Adaptive'
      default: return 'Unknown'
    }
  }
}

export default App