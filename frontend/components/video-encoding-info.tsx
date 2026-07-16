'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { VideoQuality, StreamingMethod } from '@/types/streaming'

interface VideoEncodingInfoProps {
    quality: VideoQuality | null
    streamingMethod: StreamingMethod
}

export function VideoEncodingInfo({ quality, streamingMethod }: VideoEncodingInfoProps) {
    const getStreamingFormat = () => {
        switch (streamingMethod) {
            case 'hls':
                return 'HLS (HTTP Live Streaming)'
            case 'dash':
                return 'DASH (MPEG-DASH)'
            case 'http-range':
                return 'Progressive Download (HTTP Range)'
            default:
                return 'Unknown'
        }
    }

    const getCodec = () => {
        if (!quality?.codec) return '—'

        const codec = quality.codec.toLowerCase()
        if (codec.includes('avc') || codec.includes('h264')) return 'H.264 (AVC)'
        if (codec.includes('hev') || codec.includes('h265') || codec.includes('hevc')) return 'H.265 (HEVC)'
        if (codec.includes('vp9')) return 'VP9'
        if (codec.includes('vp8')) return 'VP8'
        if (codec.includes('av01') || codec.includes('av1')) return 'AV1'

        return quality.codec
    }

    return (
        <Card className="mb-6">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Current Stream Encoding</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Format</div>
                        <div className="font-medium">{getStreamingFormat()}</div>
                    </div>
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Resolution</div>
                        <div className="font-medium">
                            {quality ? `${quality.width}×${quality.height} (${quality.label})` : '—'}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Bitrate</div>
                        <div className="font-medium">
                            {quality ? `${(quality.bitrate / 1000000).toFixed(2)} Mbps` : '—'}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Codec</div>
                        <div className="font-medium">{getCodec()}</div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
