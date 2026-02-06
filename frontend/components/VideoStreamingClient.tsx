'use client'

import { useState, useEffect } from 'react'
import type { StreamingMethod, AbrAlgorithm } from '@/types/streaming'
import { StreamingControls } from '@/components/StreamingControls'
import { VideoPlayer } from '@/components/VideoPlayer'
import { ActiveStreamingStatus } from '@/components/ActiveStreamingStatus'
import { VideoEncodingInfo } from '@/components/VideoEncodingInfo'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useVideoStats } from '@/hooks/useVideoStats'

interface VideoStreamingClientProps {
    videoFileName: string
}

export function VideoStreamingClient({ videoFileName }: VideoStreamingClientProps) {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5180'
    const [streamingMethod, setStreamingMethod] = useState<StreamingMethod>('http-range')
    const [abrAlgorithm, setAbrAlgorithm] = useState<AbrAlgorithm>('hybrid')
    const [mounted, setMounted] = useState(false)
    const { stats, updateStats, resetStats } = useVideoStats()

    useEffect(() => {
        setMounted(true)
    }, [])

    // Reset stats when streaming method or algorithm changes
    useEffect(() => {
        resetStats()
    }, [streamingMethod, abrAlgorithm, resetStats])

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
                    onStatsUpdate={updateStats}
                />

                <ActiveStreamingStatus
                    streamingMethod={streamingMethod}
                    abrAlgorithm={abrAlgorithm}
                    apiUrl={API_URL}
                    videoFileName={videoFileName}
                />
            </div>

            <VideoEncodingInfo
                quality={stats.current.quality}
                streamingMethod={streamingMethod}
            />

            <Card>
                <CardHeader>
                    <CardTitle>Real-time Statistics</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="mb-6">
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                            Average Statistics (Entire Session)
                        </h3>
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
                            <div className="p-4 bg-muted rounded-md border">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Avg Quality
                                </div>
                                <div className="text-2xl font-semibold">
                                    {stats.average.avgQuality?.label || '—'}
                                </div>
                                {stats.average.avgQuality && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                        {stats.average.avgQuality.width}x{stats.average.avgQuality.height}
                                    </div>
                                )}
                            </div>
                            <div className="p-4 bg-muted rounded-md border">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Avg Buffer Level
                                </div>
                                <div className="text-2xl font-semibold">
                                    {stats.average.avgBufferLevel.toFixed(1)}s
                                </div>
                            </div>
                            <div className="p-4 bg-muted rounded-md border">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Avg Bandwidth
                                </div>
                                <div className="text-2xl font-semibold">
                                    {stats.average.avgBandwidth.toFixed(2)} Mbps
                                </div>
                            </div>
                            <div className="p-4 bg-muted rounded-md border">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Avg Dropped Frames
                                </div>
                                <div className="text-2xl font-semibold">
                                    {stats.average.avgDroppedFramesRate.toFixed(2)}%
                                </div>
                            </div>
                            <div className="p-4 bg-muted rounded-md border">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Total Rebuffering
                                </div>
                                <div className="text-2xl font-semibold">
                                    {stats.average.totalRebufferingEvents}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                    {stats.average.totalRebufferingDuration.toFixed(1)}s total
                                </div>
                            </div>
                            <div className="p-4 bg-muted rounded-md border">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Total Playback Time
                                </div>
                                <div className="text-2xl font-semibold">
                                    {formatTime(stats.average.totalPlaybackTime)}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                            Current Statistics
                        </h3>
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
                            <div className="p-4 bg-secondary/50 rounded-md border border-primary/20">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Current Quality
                                </div>
                                <div className="text-2xl font-semibold">
                                    {stats.current.quality?.label || '—'}
                                </div>
                                {stats.current.quality && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                        {stats.current.quality.width}x{stats.current.quality.height}
                                    </div>
                                )}
                            </div>
                            <div className="p-4 bg-secondary/50 rounded-md border border-primary/20">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Buffer Level
                                </div>
                                <div className="text-2xl font-semibold">
                                    {stats.current.bufferLevel.toFixed(1)}s
                                </div>
                            </div>
                            <div className="p-4 bg-secondary/50 rounded-md border border-primary/20">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Bandwidth
                                </div>
                                <div className="text-2xl font-semibold">
                                    {stats.current.bandwidth.toFixed(2)} Mbps
                                </div>
                            </div>
                            <div className="p-4 bg-secondary/50 rounded-md border border-primary/20">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Dropped Frames
                                </div>
                                <div className="text-2xl font-semibold">
                                    {stats.current.droppedFrames}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                    of {stats.current.totalFrames} total
                                </div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </>
    )
}

/**
 * Format time in seconds to MM:SS format
 */
function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}
