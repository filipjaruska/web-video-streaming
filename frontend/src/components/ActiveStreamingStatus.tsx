import { memo } from 'react'
import type { StreamingMethod, AbrAlgorithm } from '../types/streaming'
import {
    getActiveMethodName,
    getVideoUrl,
    getStreamingMethodDescription,
    getAbrDescription,
    getDashAbrDescription,
} from '../utils/streamingLabels'

interface ActiveStreamingStatusProps {
    streamingMethod: StreamingMethod
    abrAlgorithm: AbrAlgorithm
    apiUrl: string
    videoFileName: string
}

const sectionHeaderStyle = {
    fontSize: '0.6875rem',
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '0.375rem',
}

const sectionContentStyle = {
    fontSize: '0.875rem',
    lineHeight: '1.5',
    color: '#1e293b',
}

function ActiveStreamingStatusComponent({
    streamingMethod,
    abrAlgorithm,
    apiUrl,
    videoFileName,
}: ActiveStreamingStatusProps) {
    const showAbrAlgorithm = streamingMethod === 'hls' || streamingMethod === 'dash'
    const url = getVideoUrl(streamingMethod, apiUrl, videoFileName)

    return (
        <div
            style={{
                padding: '1.25rem',
                background: 'white',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                height: '100%',
            }}
        >
            <div style={{ paddingBottom: '0.75rem', borderBottom: '2px solid #f1f5f9' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', margin: 0 }}>
                    Streaming Information
                </h2>
            </div>

            <div>
                <div style={sectionHeaderStyle}>Active Method</div>
                <div style={{ ...sectionContentStyle, fontWeight: '500' }}>
                    {getActiveMethodName(streamingMethod, showAbrAlgorithm ? abrAlgorithm : undefined)}
                </div>
            </div>

            <div>
                <div style={sectionHeaderStyle}>Protocol Details</div>
                <div style={sectionContentStyle}>
                    {getStreamingMethodDescription(streamingMethod)}
                </div>
            </div>

            {showAbrAlgorithm && (
                <div>
                    <div style={sectionHeaderStyle}>ABR Strategy</div>
                    <div style={sectionContentStyle}>
                        {streamingMethod === 'hls'
                            ? getAbrDescription(abrAlgorithm)
                            : getDashAbrDescription(abrAlgorithm)}
                    </div>
                </div>
            )}

            <div>
                <div style={sectionHeaderStyle}>
                    {streamingMethod === 'http-range' ? 'Video URL' : 'Manifest URL'}
                </div>
                <div
                    style={{
                        fontSize: '0.75rem',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        background: '#f8fafc',
                        padding: '0.625rem',
                        borderRadius: '4px',
                        wordBreak: 'break-all',
                        color: '#475569',
                        border: '1px solid #e2e8f0',
                    }}
                >
                    {url}
                </div>
            </div>

        </div>
    )
}

export const ActiveStreamingStatus = memo(ActiveStreamingStatusComponent)
