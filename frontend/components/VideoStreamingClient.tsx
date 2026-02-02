'use client'

import { useState, useEffect } from 'react'
import type { StreamingMethod, AbrAlgorithm } from '@/types/streaming'
import { StreamingControls } from '@/components/StreamingControls'
import { VideoPlayer } from '@/components/VideoPlayer'
import { ActiveStreamingStatus } from '@/components/ActiveStreamingStatus'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface VideoStreamingClientProps {
    videoFileName: string
}

export function VideoStreamingClient({ videoFileName }: VideoStreamingClientProps) {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5180'
    const [streamingMethod, setStreamingMethod] = useState<StreamingMethod>('http-range')
    const [abrAlgorithm, setAbrAlgorithm] = useState<AbrAlgorithm>('hybrid')
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return null
    }

    return (
        <>
            <StreamingControls
                streamingMethod={streamingMethod}
                abrAlgorithm={abrAlgorithm}
                onStreamingMethodChange={setStreamingMethod}
                onAbrAlgorithmChange={setAbrAlgorithm}
            />

            <div className="grid grid-cols-[1fr_360px] gap-6 items-stretch mb-6">
                <VideoPlayer
                    streamingMethod={streamingMethod}
                    abrAlgorithm={abrAlgorithm}
                    apiUrl={API_URL}
                    videoFileName={videoFileName}
                />

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
        </>
    )
}
