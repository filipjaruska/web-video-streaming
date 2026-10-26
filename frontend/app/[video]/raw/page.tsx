import { ClipRaw } from "@/feature/clip/clip-raw";

type ClipRawPageProps = {
  params: Promise<{ video: string }>;
};

export default async function ClipRawPage({ params }: ClipRawPageProps) {
  const { video } = await params;
  return <ClipRaw routeId={video} />;
}
