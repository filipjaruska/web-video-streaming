import { memo } from 'react'
import type { StreamingMethod, AbrAlgorithm } from '../types/streaming'
import {
    getActiveMethodName,
    getVideoUrl,
    getStreamingMethodDescription,
    getAbrDescription,
    getDashAbrDescription,
} from '../utils/streamingLabels'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ActiveStreamingStatusProps {
    streamingMethod: StreamingMethod
    abrAlgorithm: AbrAlgorithm
    apiUrl: string
    videoFileName: string
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
        <Card className="h-full">
            <CardHeader className="border-b">
                <CardTitle>Streaming Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                        Active Method
                    </div>
                    <div className="text-sm font-medium">
                        {getActiveMethodName(streamingMethod, showAbrAlgorithm ? abrAlgorithm : undefined)}
                    </div>
                </div>

                <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                        Protocol Details
                    </div>
                    <div className="text-sm leading-relaxed">
                        {getStreamingMethodDescription(streamingMethod)}
                    </div>
                </div>

                {showAbrAlgorithm && (
                    <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                            ABR Strategy
                        </div>
                        <div className="text-sm leading-relaxed">
                            {streamingMethod === 'hls'
                                ? getAbrDescription(abrAlgorithm)
                                : getDashAbrDescription(abrAlgorithm)}
                        </div>
                    </div>
                )}

                <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                        {streamingMethod === 'http-range' ? 'Video URL' : 'Manifest URL'}
                    </div>
                    <div className="text-xs font-mono bg-muted p-2.5 rounded border break-all">
                        {url}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

export const ActiveStreamingStatus = memo(ActiveStreamingStatusComponent)
