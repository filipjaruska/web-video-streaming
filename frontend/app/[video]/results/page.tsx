import { ClipResults } from "@/feature/clip/clip-results";

type ClipResultsPageProps = {
  params: Promise<{ video: string }>;
};

export default async function ClipResultsPage({ params }: ClipResultsPageProps) {
  const { video } = await params;
  return <ClipResults routeId={video} />;
}
