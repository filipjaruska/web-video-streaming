import Link from "next/link";
import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import { ErrorBanner } from "@/components/error-banner";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ResultsTables } from "@/feature/results/results-tables";
import { loadAllResults, type ClipResult } from "@/lib/resultsApi";
import { RESULTS_COPY } from "@/lib/siteCopy";

export const metadata: Metadata = {
  title: RESULTS_COPY.title,
  description: RESULTS_COPY.description,
};

export default async function ResultsPage() {
  let clips: ClipResult[] = [];
  let error: string | null = null;

  try {
    clips = await loadAllResults();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load results";
  }

  return (
    <PageShell
      title={RESULTS_COPY.title}
      description={RESULTS_COPY.description}
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/">Videos</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Results</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <Separator className="mb-6" />
      {error ? (
        <ErrorBanner title="Failed to load results" message={error} />
      ) : clips.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No clips in the catalogue yet. Upload one to start measuring.
        </p>
      ) : (
        <ResultsTables clips={clips} />
      )}
    </PageShell>
  );
}
