'use client'

import { useVideoPlayer } from '@/hooks/useVideoPlayer'
import type { StreamingMethod, AbrAlgorithm, CurrentStats } from '@/types/streaming'
import { ErrorBanner } from '@/components/error-banner'

interface VideoPlayerProps {
    streamingMethod: StreamingMethod
    abrAlgorithm: AbrAlgorithm
    apiUrl: string
    videoFileName: string
    onStatsUpdate?: (stats: Partial<CurrentStats>) => void
}

export function VideoPlayer({ streamingMethod, abrAlgorithm, apiUrl, videoFileName, onStatsUpdate }: VideoPlayerProps) {
    const { videoRef, error } = useVideoPlayer({
        streamingMethod,
        abrAlgorithm,
        apiUrl,
        videoFileName,
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
