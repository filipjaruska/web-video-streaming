import { useState, useEffect, useRef } from 'react'
import Hls from 'hls.js'
import './App.css'

type StreamingMethod = 'http-range' | 'hls'

function App() {
  const API_URL = 'http://localhost:5180'
  const videoFileName = 'sample.mp4'

  const [streamingMethod, setStreamingMethod] = useState<StreamingMethod>('http-range')
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!videoRef.current) return
    if (hlsInstance) {
      hlsInstance.destroy()
      setHlsInstance(null)
    }

    if (streamingMethod === 'hls') {
      if (Hls.isSupported()) {
        const hls = new Hls({
          debug: false,
          enableWorker: true,
          lowLatencyMode: false,
        })
        // https://www.npmjs.com/package/hls.js#:~:text=hls.js%40canary-,Embedding%20HLS.js,-Directly%20include%20dist
        const hlsUrl = `${API_URL}/api/hls/${videoFileName.replace('.mp4', '')}/master.m3u8`
        hls.loadSource(hlsUrl)
        hls.attachMedia(videoRef.current)

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
    } else {
      videoRef.current.src = `${API_URL}/api/video/${videoFileName}`
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingMethod, API_URL, videoFileName])

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
              <option value="hls">HLS (HTTP Live Streaming)</option>
            </select>
          </label>

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
                <strong>HTTP Range Requests:</strong> Traditional video delivery.
                Single quality, browser requests video chunks as needed.
                Simple with no quality adaptation.
              </>
            ) : (
              <>
                <strong>HLS (Adaptive):</strong> Streaming protocol.
                Multiple quality levels, automatically adapts to network conditions.
                Used by YouTube.
              </>
            )}
            // TODO: Add dash, used by Netflix.
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
            Active Method: {streamingMethod === 'http-range' ? 'HTTP Range Requests' : 'HLS Adaptive Streaming'}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#666' }}>
            {streamingMethod === 'http-range' ? (
              <>URL: {`${API_URL}/api/video/${videoFileName}`}</>
            ) : (
              <>Manifest: {`${API_URL}/api/hls/${videoFileName.replace('.mp4', '')}/master.m3u8`}</>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App