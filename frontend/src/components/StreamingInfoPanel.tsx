import type { StreamingMethod, AbrAlgorithm } from '../types/streaming'
import {
    getStreamingMethodTitle,
    getStreamingMethodDescription,
    getAbrDescription,
    getDashAbrDescription,
} from '../utils/streamingLabels'

interface StreamingInfoPanelProps {
    streamingMethod: StreamingMethod
    abrAlgorithm: AbrAlgorithm
    showAbrSelector: boolean
}

export function StreamingInfoPanel({
    streamingMethod,
    abrAlgorithm,
    showAbrSelector,
}: StreamingInfoPanelProps) {
    return (
        <div
            style={{
                marginTop: '0.75rem',
                padding: '0.75rem',
                background: 'white',
                borderRadius: '4px',
                fontSize: '0.9rem',
                color: '#495057',
                minHeight: '85px',
            }}
        >
            {streamingMethod === 'http-range' ? (
                <>
                    <strong>{getStreamingMethodTitle(streamingMethod)}</strong>{' '}
                    {getStreamingMethodDescription(streamingMethod)}
                </>
            ) : (
                <>
                    <strong>{getStreamingMethodTitle(streamingMethod)}</strong>{' '}
                    {getStreamingMethodDescription(streamingMethod)}
                    {showAbrSelector && (
                        <>
                            <br />
                            <span
                                style={{
                                    fontSize: '0.85rem',
                                    color: '#666',
                                    marginTop: '0.25rem',
                                    display: 'block',
                                }}
                            >
                                {streamingMethod === 'hls'
                                    ? getAbrDescription(abrAlgorithm)
                                    : getDashAbrDescription(abrAlgorithm)}
                            </span>
                        </>
                    )}
                </>
            )}
        </div>
    )
}
