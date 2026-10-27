import { PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { RESULTS_COPY } from "@/lib/siteCopy";

export default function Loading() {
  return (
    <PageShell title={RESULTS_COPY.title} description={RESULTS_COPY.description}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="hidden space-y-3 xl:block">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-4 w-40" />
          ))}
        </div>
        <div className="space-y-10">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-4 border-t pt-6">
              <Skeleton className="h-6 w-72" />
              <Skeleton className="h-64 w-full" />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
