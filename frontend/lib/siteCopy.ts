/**
 * Page titles and descriptions shared between a route and its loading skeleton, so the skeleton
 * never shows different copy from the page it stands in for.
 */
export const HOME_COPY = {
  title: "Clips",
  description:
    "Animated clips, each packaged as a static, a content-adaptive and an animation-optimised ladder and played over HLS and DASH.",
} as const;

export const RESULTS_COPY = {
  title: "Results",
  description:
    "Every clip measured the same way, laid out as in chapter 5. Select a clip for its own results.",
} as const;

export const METHOD_COPY = {
  title: "Method",
  description: "The measures and terms used across the results, defined once.",
} as const;
