"use client";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { Card, CardContent } from "@/components/ui/card";

export function VideoPlayerSkeleton() {
  return (
    <SkeletonTheme baseColor="var(--muted)" highlightColor="var(--accent)">
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="aspect-video w-full">
            <Skeleton
              className="!h-full !rounded-md"
              containerClassName="block h-full leading-none"
            />
          </div>
          <Skeleton height={280} className="!rounded-md" />
        </div>
      </div>
    </SkeletonTheme>
  );
}
