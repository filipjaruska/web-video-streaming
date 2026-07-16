import Link from "next/link"
import { VideoStreamingClient } from "@/components/video-streaming-client"
import { PageShell } from "@/components/page-shell"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export default async function VideoPage({ params }: { params: Promise<{ video: string }> }) {
  const { video } = await params
  const videoFileName = `${video}.mp4`

  return (
    <PageShell
      title={video}
      description="Compare HTTP Range, HLS, and DASH streaming protocols with different ABR algorithms"
      actionLabel="Display Analysis"
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/">Videos</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{videoFileName}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <Separator className="mb-6" />
      <VideoStreamingClient videoFileName={videoFileName} />
    </PageShell>
  )
}
