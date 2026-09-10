import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import { RESULTS_COPY } from "@/lib/siteCopy";

export default function Loading() {
  return (
    <PageShell title={RESULTS_COPY.title} description={RESULTS_COPY.description}>
      <Separator className="mb-6" />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
              <div className="h-3 w-32 animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-56 animate-pulse rounded-xl border bg-muted/40"
          />
        ))}
      </div>
    </PageShell>
  );
}
