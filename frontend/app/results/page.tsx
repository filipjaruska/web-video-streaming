import type { Metadata } from "next";
import { connection } from "next/server";

import { ErrorBanner } from "@/components/error-banner";
import { PageShell } from "@/components/page-shell";
import { SectionIndex } from "@/components/section-index";
import { Chapter5View, RESULT_SECTIONS } from "@/feature/results/chapter5-view";
import { ResultsToolbar } from "@/feature/results/results-toolbar";
import { loadChapter5 } from "@/lib/serverCache";
import type { Chapter5Report } from "@/lib/results/chapter5";
import { RESULTS_COPY } from "@/lib/siteCopy";

export const metadata: Metadata = {
  title: "Results",
  description: "Measurements across all videos.",
};

export default async function ResultsPage() {
  let report: Chapter5Report | null = null;
  let error: string | null = null;

  try {
    report = await loadChapter5();
  } catch (err) {
    // Rendered per request, so a failure during the build is not prerendered into the page.
    await connection();
    error = err instanceof Error ? err.message : "The results could not be loaded.";
  }

  return (
    <PageShell
      title={RESULTS_COPY.title}
      description={RESULTS_COPY.description}
      actions={<ResultsToolbar />}
    >
      {error && <ErrorBanner title="Results unavailable" message={error} />}
      {report && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 xl:grid-cols-[15rem_minmax(0,1fr)]">
          <SectionIndex sections={RESULT_SECTIONS} />
          <Chapter5View report={report} />
        </div>
      )}
    </PageShell>
  );
}
