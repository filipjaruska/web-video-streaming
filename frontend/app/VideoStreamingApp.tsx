'use client'

import { useState } from 'react'
import type { StreamingMethod, AbrAlgorithm } from './types/streaming'
import { useVideoPlayer } from './hooks/useVideoPlayer'
import { StreamingControls } from './components/StreamingControls'
import { ErrorDisplay } from './components/ErrorDisplay'
import { ActiveStreamingStatus } from './components/ActiveStreamingStatus'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function VideoStreamingApp() {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5180'
    const videoFileName = process.env.NEXT_PUBLIC_VIDEO_FILE_NAME || 'videos_sample.mp4'

    const [streamingMethod, setStreamingMethod] = useState<StreamingMethod>('http-range')
    const [abrAlgorithm, setAbrAlgorithm] = useState<AbrAlgorithm>('hybrid')

    const { videoRef, error } = useVideoPlayer({
        streamingMethod,
        abrAlgorithm,
        apiUrl: API_URL,
        videoFileName,
    })

    return (
        <div className="p-8 min-h-screen">
            <div className="max-w-[1400px] mx-auto">
                <header className="mb-8">
                    <h1 className="text-3xl font-semibold mb-2">
                        Video Streaming Comparison
                    </h1>
                    <p className="text-muted-foreground">
                        Compare HTTP Range, HLS, and DASH streaming protocols with different ABR algorithms
                    </p>
                </header>

                <StreamingControls
                    streamingMethod={streamingMethod}
                    abrAlgorithm={abrAlgorithm}
                    onStreamingMethodChange={setStreamingMethod}
                    onAbrAlgorithmChange={setAbrAlgorithm}
                />

                <div className="grid grid-cols-[1fr_360px] gap-6 items-stretch mb-6">
                    <div className="relative">
                        {error ? (
                            <ErrorDisplay error={error} />
                        ) : (
                            <video
                                ref={videoRef}
                                controls
                                preload="none"
                                className="w-full rounded-lg shadow-sm bg-black aspect-video block"
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

                <Card>
                    <CardHeader>
                        <CardTitle>Real-time Statistics</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
                            <div className="p-4 bg-muted rounded-md border">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Current Quality
                                </div>
                                <div className="text-2xl font-semibold">
                                    —
                                </div>
                            </div>
                            <div className="p-4 bg-muted rounded-md border">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Buffer Level
                                </div>
                                <div className="text-2xl font-semibold">
                                    —
                                </div>
                            </div>
                            <div className="p-4 bg-muted rounded-md border">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Bandwidth
                                </div>
                                <div className="text-2xl font-semibold">
                                    —
                                </div>
                            </div>
                            <div className="p-4 bg-muted rounded-md border">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Dropped Frames
                                </div>
                                <div className="text-2xl font-semibold">
                                    —
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
