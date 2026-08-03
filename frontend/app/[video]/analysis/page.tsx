import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnalysisPageClient } from "@/feature/analysis/analysis-page-client";
import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { listVideos } from "@/lib/videoApi";

type AnalysisPageProps = {
  params: Promise<{ video: string }>;
};

export async function generateMetadata({
  params,
}: AnalysisPageProps): Promise<Metadata> {
  const { video } = await params;

  try {
    const { videos } = await listVideos();
    const match = videos.find((v) => v.routeId === video);
    if (match) {
      const label = match.title || match.fileName;
      return {
        title: `${label} · Analysis`,
        description: `Source analysis and quality metrics for ${label}`,
      };
    }
  } catch {
    // Fall through
  }

  return {
    title: `${video} · Analysis`,
    description: "Source analysis and quality metrics",
  };
}

export default async function AnalysisPage({ params }: AnalysisPageProps) {
  const { video } = await params;

  let displayName = video;
  try {
    const { videos } = await listVideos();
    const match = videos.find((v) => v.routeId === video);
    if (!match) {
      notFound();
    }
    displayName = match.title || match.fileName || video;
  } catch {
    // If catalog is unreachable, still render the analysis shell
  }

  return (
    <PageShell
      title="Source analysis"
      description={`MediaInfo-style metadata, SI/TI charts, and transcode analysis for ${displayName}.`}
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
              <BreadcrumbLink asChild>
                <Link href={`/${video}`}>{displayName}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Analysis</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <Separator className="mb-6" />
      <AnalysisPageClient routeId={video} />
    </PageShell>
  );
}
