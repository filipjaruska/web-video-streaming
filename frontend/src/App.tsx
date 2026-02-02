import { useState } from 'react'
import type { StreamingMethod, AbrAlgorithm } from './types/streaming'
import { useVideoPlayer } from './hooks/useVideoPlayer'
import { StreamingControls } from './components/StreamingControls'
import { ErrorDisplay } from './components/ErrorDisplay'
import { ActiveStreamingStatus } from './components/ActiveStreamingStatus'
import './App.css'

function App() {
  const API_URL = import.meta.env.VITE_API_URL
  const videoFileName = import.meta.env.VITE_VIDEO_FILE_NAME

  const [streamingMethod, setStreamingMethod] = useState<StreamingMethod>('http-range')
  const [abrAlgorithm, setAbrAlgorithm] = useState<AbrAlgorithm>('hybrid')

  const { videoRef, error } = useVideoPlayer({
    streamingMethod,
    abrAlgorithm,
    apiUrl: API_URL,
    videoFileName,
  })

  return (
    <div style={{ padding: '2rem 1.5rem', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <header style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.875rem', fontWeight: '600', marginBottom: '0.5rem', color: '#0f172a' }}>
            Video Streaming Comparison
          </h1>
          <p style={{ color: '#64748b', fontSize: '1rem' }}>
            Compare HTTP Range, HLS, and DASH streaming protocols with different ABR algorithms
          </p>
        </header>

        <StreamingControls
          streamingMethod={streamingMethod}
          abrAlgorithm={abrAlgorithm}
          onStreamingMethodChange={setStreamingMethod}
          onAbrAlgorithmChange={setAbrAlgorithm}
        />

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 360px',
          gap: '1.5rem',
          alignItems: 'stretch',
          marginBottom: '1.5rem',
        }}>
          <div style={{ position: 'relative' }}>
            {error ? (
              <ErrorDisplay error={error} />
            ) : (
              <video
                ref={videoRef}
                controls
                preload="none"
                width="100%"
                style={{
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  background: '#000',
                  aspectRatio: '16/9',
                  display: 'block',
                }}
              >
                Your browser does not support the video tag.
              </video>
            )}
          </div>

          <ActiveStreamingStatus
            streamingMethod={streamingMethod}
            abrAlgorithm={abrAlgorithm}
            apiUrl={API_URL}
            videoFileName={videoFileName}
          />
        </div>

        {/* Stats Panel */}
        <div style={{
          padding: '1.25rem',
          background: 'white',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginBottom: '1rem' }}>
            Real-time Statistics
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
          }}>
            <div style={{
              padding: '1rem',
              background: '#f8fafc',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
            }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Current Quality
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: '600', color: '#0f172a' }}>
                —
              </div>
            </div>
            <div style={{
              padding: '1rem',
              background: '#f8fafc',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
            }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Buffer Level
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: '600', color: '#0f172a' }}>
                —
              </div>
            </div>
            <div style={{
              padding: '1rem',
              background: '#f8fafc',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
            }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Bandwidth
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: '600', color: '#0f172a' }}>
                —
              </div>
            </div>
            <div style={{
              padding: '1rem',
              background: '#f8fafc',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
            }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Dropped Frames
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: '600', color: '#0f172a' }}>
                —
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App