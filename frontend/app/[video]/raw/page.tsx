import { ClipRaw } from "@/feature/clip/clip-raw";
import { isProcessing } from "@/lib/clipLookup";

type ClipRawPageProps = {
  params: Promise<{ video: string }>;
};

export default async function ClipRawPage({ params }: ClipRawPageProps) {
  const { video } = await params;
  return <ClipRaw routeId={video} poll={await isProcessing(video)} />;
}
