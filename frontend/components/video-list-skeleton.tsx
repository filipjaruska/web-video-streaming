"use client";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { Card } from "@/components/ui/card";

export function VideoListSkeleton() {
  return (
    <SkeletonTheme baseColor="var(--muted)" highlightColor="var(--accent)">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 @min-[1400px]/page:grid-cols-4 gap-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="overflow-hidden gap-0 py-0">
            <div className="aspect-video w-full">
              <Skeleton
                className="!h-full !rounded-none"
                containerClassName="block h-full leading-none"
              />
            </div>
            <div className="p-4 space-y-2">
              <Skeleton width="70%" height={18} />
              <Skeleton width="40%" height={14} />
            </div>
          </Card>
        ))}
      </div>
    </SkeletonTheme>
  );
}
