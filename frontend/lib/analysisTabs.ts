/**
 * The analysis view's tab vocabulary.
 *
 * Kept in a module with no `"use client"` directive because the route validates the `?tab=` query
 * on the server before handing it to the client component. A helper exported from a client module
 * cannot be called during server rendering — only rendered as a component or passed as a prop —
 * so the shared vocabulary has to live outside the boundary.
 *
 * Treated as a stable API: the concepts page deep-links into individual tabs, so renaming an id
 * silently breaks those links. Add ids rather than reusing them.
 */
export const ANALYSIS_TABS = [
  "content",
  "ladder",
  "tuning",
  "cost",
  "delivery",
  "raw",
] as const;

export type AnalysisTab = (typeof ANALYSIS_TABS)[number];

export const DEFAULT_ANALYSIS_TAB: AnalysisTab = "content";

export function isAnalysisTab(value: string | undefined | null): value is AnalysisTab {
  return !!value && (ANALYSIS_TABS as readonly string[]).includes(value);
}

/** Narrows a query value to a tab, falling back so a stale link degrades instead of breaking. */
export function resolveAnalysisTab(value: string | undefined | null): AnalysisTab {
  return isAnalysisTab(value) ? value : DEFAULT_ANALYSIS_TAB;
}
