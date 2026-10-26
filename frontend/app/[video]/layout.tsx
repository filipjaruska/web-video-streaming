import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageShell } from "@/components/page-shell";
import { StatusBadge } from "@/components/status-badge";
import { ClipManageMenu } from "@/feature/clip/clip-manage-menu";
import { ClipTabs } from "@/feature/clip/clip-tabs";
import { findClip } from "@/lib/clipLookup";

type ClipLayoutProps = {
  params: Promise<{ video: string }>;
  children: ReactNode;
};

export async function generateMetadata({
  params,
}: Pick<ClipLayoutProps, "params">): Promise<Metadata> {
  const { video } = await params;
  const clip = await findClip(video);
  const title = clip ? clip.title || clip.fileName : video;
  return { title, description: clip?.description ?? `Playback and results for ${title}` };
}

export default async function ClipLayout({ params, children }: ClipLayoutProps) {
  const { video } = await params;
  const clip = await findClip(video);
  if (clip === null) {
    notFound();
  }

  return (
    <PageShell
      eyebrow={clip ? <span className="font-mono">{clip.fileName}</span> : undefined}
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {clip ? clip.title || clip.fileName : video}
          {clip && clip.status !== "ready" && <StatusBadge status={clip.status} />}
        </span>
      }
      description={clip?.description ?? undefined}
      actions={clip ? <ClipManageMenu video={clip} /> : undefined}
      below={<ClipTabs routeId={video} />}
    >
      <div className="pt-6">{children}</div>
    </PageShell>
  );
}
