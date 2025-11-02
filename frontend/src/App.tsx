import './App.css'

function App() {
  const API_URL = 'http://localhost:5180';
  const videoFileName = 'sample.mp4';

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Video Streaming App</h1>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <video
          controls
          width="100%"
          style={{ borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
        >
          <source
            src={`${API_URL}/api/video/${videoFileName}`}
            type="video/mp4"
          />
          Your browser does not support the video tag.
        </video>
        <p style={{ marginTop: '1rem', color: '#666' }}>
          Video URL: {`${API_URL}/api/video/${videoFileName}`}
        </p>
      </div>
    </div>
  )
}

export default App
