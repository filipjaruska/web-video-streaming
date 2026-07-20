import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import { UploadSessionPage } from "@/components/upload-session-page";
import { getApiUrl } from "@/lib/env";
import { getUploadSession } from "@/lib/videoApi";

type UploadPageProps = {
  params: Promise<{ uuid: string }>;
};

export const metadata: Metadata = {
  title: "Upload session",
  description: "Manage upload metadata and track upload pipeline state.",
};

export default async function UploadPage({ params }: UploadPageProps) {
  const { uuid } = await params;

  try {
    const session = await getUploadSession(getApiUrl(), uuid);

    return (
      <PageShell
        title={session.video.title ?? "Upload session"}
        description="This session page persists on the backend so users can return to it across refreshes and devices."
      >
        <Separator className="mb-6" />
        <UploadSessionPage initialSession={session} />
      </PageShell>
    );
  } catch {
    notFound();
  }
}
