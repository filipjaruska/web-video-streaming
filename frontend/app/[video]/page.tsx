import { VideoStreamingClient } from '@/components/VideoStreamingClient'

    const { video } = await params
    const videoFileName = `${video}.mp4`

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

                <VideoStreamingClient videoFileName={videoFileName} />
            </div>
        </div>
    )
}