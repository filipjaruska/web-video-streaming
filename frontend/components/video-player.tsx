'use client'

import { useVideoPlayer } from '@/hooks/useVideoPlayer'
import type { StreamingMethod, AbrAlgorithm, CurrentStats } from '@/types/streaming'
import { ErrorBanner } from '@/components/error-banner'

interface VideoPlayerProps {
    streamingMethod: StreamingMethod
    abrAlgorithm: AbrAlgorithm
    apiUrl: string
    routeId: string
    transcodeId?: string | null
    onStatsUpdate?: (stats: Partial<CurrentStats>) => void
}

export function VideoPlayer({ streamingMethod, abrAlgorithm, apiUrl, routeId, transcodeId = null, onStatsUpdate }: VideoPlayerProps) {
    const { videoRef, error } = useVideoPlayer({
        streamingMethod,
        abrAlgorithm,
        apiUrl,
        routeId,
        transcodeId,
        onStatsUpdate,
    })

    return (
        <div className="relative space-y-3">
            {error && <ErrorBanner title="Playback Error" message={error} />}
            <video
                ref={videoRef}
                controls
                preload="none"
                className="w-full rounded-md shadow-sm bg-black aspect-video block"
            >
                Your browser does not support the video tag.
            </video>
        </div>
    )
}
