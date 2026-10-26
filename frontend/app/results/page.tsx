import type { Metadata } from "next";

import { ErrorBanner } from "@/components/error-banner";
import { PageShell } from "@/components/page-shell";
import { Chapter5View, ResultsIndex } from "@/feature/results/chapter5-view";
import { ResultsToolbar } from "@/feature/results/results-toolbar";
import { loadChapter5 } from "@/lib/results/loadChapter5";
import type { Chapter5Report } from "@/lib/results/chapter5";
import { RESULTS_COPY } from "@/lib/siteCopy";

export const metadata: Metadata = {
  title: "Results",
  description: "Results across all clips, in the order of chapter 5 of the thesis.",
};

export default async function ResultsPage() {
  let report: Chapter5Report | null = null;
  let error: string | null = null;

  try {
    report = await loadChapter5();
  } catch (err) {
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
        <div className="grid gap-10 xl:grid-cols-[15rem_minmax(0,1fr)]">
          <ResultsIndex />
          <Chapter5View report={report} />
        </div>
      )}
    </PageShell>
  );
}
