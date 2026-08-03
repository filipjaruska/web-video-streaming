"use client";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { Card, CardContent } from "@/components/ui/card";

export function VideoPlayerSkeleton() {
  return (
    <SkeletonTheme baseColor="var(--muted)" highlightColor="var(--accent)">
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between gap-3">
              <Skeleton height={28} width={160} />
              <Skeleton height={24} width={220} />
            </div>
          </CardContent>
        </Card>
        <div className="aspect-video w-full">
          <Skeleton
            className="!h-full !rounded-md"
            containerClassName="block h-full leading-none"
          />
        </div>
        <Skeleton height={28} width="60%" />
        <Card>
          <CardContent className="pt-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Skeleton height={72} />
              <Skeleton height={72} />
              <Skeleton height={72} />
              <Skeleton height={72} />
            </div>
          </CardContent>
        </Card>
      </div>
    </SkeletonTheme>
  );
}
