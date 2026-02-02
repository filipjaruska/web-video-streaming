import { memo } from 'react'
import type { StreamingMethod, AbrAlgorithm } from '../types/streaming'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface StreamingControlsProps {
    streamingMethod: StreamingMethod
    abrAlgorithm: AbrAlgorithm
    onStreamingMethodChange: (method: StreamingMethod) => void
    onAbrAlgorithmChange: (algorithm: AbrAlgorithm) => void
}

function StreamingControlsComponent({
    streamingMethod,
    abrAlgorithm,
    onStreamingMethodChange,
    onAbrAlgorithmChange,
}: StreamingControlsProps) {
    const isAdaptive = streamingMethod === 'hls' || streamingMethod === 'dash'

    return (
        <Card className="mb-6">
            <CardContent>
                <div className="grid grid-cols-2 gap-5">
                    <div className="space-y-2">
                        <Label>Streaming Protocol</Label>
                        <Select value={streamingMethod} onValueChange={onStreamingMethodChange}>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="http-range">HTTP Range Requests</SelectItem>
                                <SelectItem value="hls">HLS (HTTP Live Streaming)</SelectItem>
                                <SelectItem value="dash">DASH (Dynamic Adaptive Streaming)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>ABR Algorithm</Label>
                        <Select
                            value={isAdaptive ? abrAlgorithm : ""}
                            onValueChange={onAbrAlgorithmChange}
                            disabled={!isAdaptive}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder={!isAdaptive ? "N/A - Not adaptive streaming" : undefined} />
                            </SelectTrigger>
                            <SelectContent>
                                {isAdaptive && (
                                    <>
                                        <SelectItem value="hybrid">Hybrid (Recommended)</SelectItem>
                                        <SelectItem value="throughput">Throughput-Based</SelectItem>
                                        <SelectItem value="buffer">Buffer-Based (BOLA)</SelectItem>
                                        <SelectItem value="baseline">Non-Adaptive</SelectItem>
                                    </>
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

export const StreamingControls = memo(StreamingControlsComponent)
