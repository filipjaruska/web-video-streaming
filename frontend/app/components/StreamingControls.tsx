import { memo } from 'react'
import type { StreamingMethod, AbrAlgorithm } from '../types/streaming'

interface StreamingControlsProps {
    streamingMethod: StreamingMethod
    abrAlgorithm: AbrAlgorithm
    onStreamingMethodChange: (method: StreamingMethod) => void
    onAbrAlgorithmChange: (algorithm: AbrAlgorithm) => void
}

const selectStyle = {
    width: '100%',
    padding: '0.625rem 0.75rem',
    fontSize: '0.9375rem',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    cursor: 'pointer',
    background: 'white',
    color: '#1e293b',
}

const labelStyle = {
    display: 'block',
    marginBottom: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#475569',
}

function StreamingControlsComponent({
    streamingMethod,
    abrAlgorithm,
    onStreamingMethodChange,
    onAbrAlgorithmChange,
}: StreamingControlsProps) {
    const isAdaptive = streamingMethod === 'hls' || streamingMethod === 'dash'

    return (
        <div
            style={{
                marginBottom: '1.5rem',
                padding: '1.25rem',
                background: 'white',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
        >
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1.25rem',
            }}>
                <div>
                    <label style={labelStyle}>
                        Streaming Protocol
                    </label>
                    <select
                        value={streamingMethod}
                        onChange={(e) => onStreamingMethodChange(e.target.value as StreamingMethod)}
                        style={selectStyle}
                    >
                        <option value="http-range">HTTP Range Requests</option>
                        <option value="hls">HLS (HTTP Live Streaming)</option>
                        <option value="dash">DASH (Dynamic Adaptive Streaming)</option>
                    </select>
                </div>

                <div>
                    <label style={labelStyle}>
                        ABR Algorithm
                    </label>
                    <select
                        value={abrAlgorithm}
                        onChange={(e) => onAbrAlgorithmChange(e.target.value as AbrAlgorithm)}
                        style={{
                            ...selectStyle,
                            opacity: isAdaptive ? 1 : 0.5,
                            cursor: isAdaptive ? 'pointer' : 'not-allowed',
                        }}
                        disabled={!isAdaptive}
                    >
                        {!isAdaptive ? (
                            <option value="">N/A - Not adaptive streaming</option>
                        ) : (
                            <>
                                <option value="hybrid">Hybrid (Recommended)</option>
                                <option value="throughput">Throughput-Based</option>
                                <option value="buffer">Buffer-Based (BOLA)</option>
                                <option value="baseline">Non-Adaptive</option>
                            </>
                        )}
                    </select>
                </div>
            </div>
        </div>
    )
}

export const StreamingControls = memo(StreamingControlsComponent)
