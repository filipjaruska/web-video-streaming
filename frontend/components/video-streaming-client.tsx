'use client'

import { useState, useEffect } from 'react'
import type { StreamingMethod, AbrAlgorithm } from '@/types/streaming'
import { StreamingControls } from '@/components/streaming-controls'
import { VideoPlayer } from '@/components/video-player'
import { ActiveStreamingStatus } from '@/components/active-streaming-status'
import { VideoEncodingInfo } from '@/components/video-encoding-info'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useVideoStats } from '@/hooks/useVideoStats'
import { getPublicApiUrl } from '@/lib/env'

interface VideoStreamingClientProps {
    videoFileName: string
}

function StatTile({
    label,
    value,
    detail,
    emphasize,
}: {
    label: string
    value: string
    detail?: string
    emphasize?: boolean
}) {
    return (
        <div
            className={
                emphasize
                    ? 'p-3 bg-secondary/50 rounded-md border border-primary/15'
                    : 'p-3 bg-muted/60 rounded-md border'
            }
        >
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                {label}
            </div>
            <div className="text-xl font-semibold tracking-tight">{value}</div>
            {detail && <div className="text-xs text-muted-foreground mt-1">{detail}</div>}
        </div>
    )
}

export function VideoStreamingClient({ videoFileName }: VideoStreamingClientProps) {
    const apiUrl = getPublicApiUrl()
    const [streamingMethod, setStreamingMethod] = useState<StreamingMethod>('http-range')
    const [abrAlgorithm, setAbrAlgorithm] = useState<AbrAlgorithm>('hybrid')
    const { stats, updateStats, resetStats } = useVideoStats()

    useEffect(() => {
        resetStats()
    }, [streamingMethod, abrAlgorithm, resetStats])

    return (
        <>
            <StreamingControls
                streamingMethod={streamingMethod}
                abrAlgorithm={abrAlgorithm}
                onStreamingMethodChange={setStreamingMethod}
                onAbrAlgorithmChange={setAbrAlgorithm}
            />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-stretch mb-6">
                <VideoPlayer
                    streamingMethod={streamingMethod}
                    abrAlgorithm={abrAlgorithm}
                    apiUrl={apiUrl}
                    videoFileName={videoFileName}
                    onStatsUpdate={updateStats}
                />

                <ActiveStreamingStatus
                    streamingMethod={streamingMethod}
                    abrAlgorithm={abrAlgorithm}
                    apiUrl={apiUrl}
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
                <CardContent className="space-y-6">
                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                            Average Statistics (Entire Session)
                        </h3>
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
                            <StatTile
                                label="Avg Quality"
                                value={stats.average.avgQuality?.label || '—'}
                                detail={
                                    stats.average.avgQuality
                                        ? `${stats.average.avgQuality.width}x${stats.average.avgQuality.height}`
                                        : undefined
                                }
                            />
                            <StatTile
                                label="Avg Buffer Level"
                                value={`${stats.average.avgBufferLevel.toFixed(1)}s`}
                            />
                            <StatTile
                                label="Avg Bandwidth"
                                value={`${stats.average.avgBandwidth.toFixed(2)} Mbps`}
                            />
                            <StatTile
                                label="Avg Dropped Frames"
                                value={`${stats.average.avgDroppedFramesRate.toFixed(2)}%`}
                            />
                            <StatTile
                                label="Total Rebuffering"
                                value={String(stats.average.totalRebufferingEvents)}
                                detail={`${stats.average.totalRebufferingDuration.toFixed(1)}s total`}
                            />
                            <StatTile
                                label="Total Playback Time"
                                value={formatTime(stats.average.totalPlaybackTime)}
                            />
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                            Current Statistics
                        </h3>
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
                            <StatTile
                                emphasize
                                label="Current Quality"
                                value={stats.current.quality?.label || '—'}
                                detail={
                                    stats.current.quality
                                        ? `${stats.current.quality.width}x${stats.current.quality.height}`
                                        : undefined
                                }
                            />
                            <StatTile
                                emphasize
                                label="Buffer Level"
                                value={`${stats.current.bufferLevel.toFixed(1)}s`}
                            />
                            <StatTile
                                emphasize
                                label="Bandwidth"
                                value={`${stats.current.bandwidth.toFixed(2)} Mbps`}
                            />
                            <StatTile
                                emphasize
                                label="Dropped Frames"
                                value={String(stats.current.droppedFrames)}
                                detail={`of ${stats.current.totalFrames} total`}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </>
    )
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}
