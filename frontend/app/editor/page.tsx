import Link from "next/link";
import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import { ErrorBanner } from "@/components/error-banner";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { EditorTable } from "@/feature/editor/editor-table";
import { listVideos, type VideoListItem } from "@/lib/videoApi";
import { EDITOR_COPY } from "@/lib/siteCopy";

export const metadata: Metadata = {
  title: EDITOR_COPY.title,
  description: EDITOR_COPY.description,
};

export default async function EditorPage() {
  let videos: VideoListItem[] = [];
  let error: string | null = null;

  try {
    const data = await listVideos();
    videos = data.videos;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load videos";
  }

  return (
    <PageShell
      title={EDITOR_COPY.title}
      description={EDITOR_COPY.description}
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
              <BreadcrumbPage>Editor</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <Separator className="mb-6" />
      {error ? (
        <ErrorBanner title="Failed to load videos" message={error} />
      ) : (
        <EditorTable videos={videos} />
      )}
    </PageShell>
  );
}
