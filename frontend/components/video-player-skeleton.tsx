import { Skeleton } from "@/components/ui/skeleton";

export function VideoPlayerSkeleton() {
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        <Skeleton className="aspect-video w-full" />
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12" />
          ))}
        </div>
      </div>
      <Skeleton className="hidden h-48 xl:block" />
    </div>
  );
}
