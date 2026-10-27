import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { UploadSessionPage } from "@/components/upload-session-page";
import { getApiUrl } from "@/lib/env";
import { getUploadSession } from "@/lib/videoApi";

type UploadPageProps = {
  params: Promise<{ uuid: string }>;
};

export const metadata: Metadata = {
  title: "Upload",
  description: "Upload a video and follow its processing.",
};

export default async function UploadPage({ params }: UploadPageProps) {
  const { uuid } = await params;
  const session = await getUploadSession(getApiUrl(), uuid).catch(() => notFound());

  // The page renders its own header: the title and description follow the form as it is edited.
  return <UploadSessionPage initialSession={session} />;
}
