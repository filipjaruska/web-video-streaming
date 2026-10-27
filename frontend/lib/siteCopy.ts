/**
 * Page titles and descriptions shared between a route and its loading skeleton, so the skeleton
 * never shows different copy from the page it stands in for.
 */
export const HOME_COPY = {
  title: "Videos",
  description:
    "Animated videos, each packaged as a static, a content-adaptive and an animation-optimised ladder and played over HLS and DASH.",
} as const;

export const RESULTS_COPY = {
  title: "Results",
  description: "Every video measured the same way. Select a video for its own results.",
} as const;

export const METHOD_COPY = {
  title: "Method",
  description: "The measures and terms used across the results, defined once.",
} as const;
