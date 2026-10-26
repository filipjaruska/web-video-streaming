import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { UploadSessionPage } from "@/components/upload-session-page";
import { getApiUrl } from "@/lib/env";
import { getUploadSession } from "@/lib/videoApi";

type UploadPageProps = {
  params: Promise<{ uuid: string }>;
};

export const metadata: Metadata = {
  title: "Upload",
  description: "Upload a clip and follow its processing.",
};

export default async function UploadPage({ params }: UploadPageProps) {
  const { uuid } = await params;
  const session = await getUploadSession(getApiUrl(), uuid).catch(() => notFound());
  const awaitingFile = session.session.status === "AwaitingUpload";

  return (
    <PageShell
      eyebrow="Upload"
      title={session.video.title || session.video.originalFileName || "New clip"}
      description={
        awaitingFile
          ? "The clip is analysed, packaged as three ladders and compared. This page can be left and reopened; processing carries on."
          : "Results fill in below as each step finishes. This page can be left and reopened."
      }
    >
      <UploadSessionPage initialSession={session} />
    </PageShell>
  );
}
