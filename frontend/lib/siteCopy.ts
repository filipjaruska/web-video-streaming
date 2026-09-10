/**
 * Page titles and descriptions shared between a route and its loading skeleton.
 *
 * These pairs must match, or the skeleton flashes different copy than the page it stands in for.
 * They drifted once already — the home skeleton read "Video Streaming Demo Description" — so they
 * live in one place now.
 */
export const HOME_COPY = {
  title: "Adaptive streaming for animated content",
  description:
    "A measurement harness for per-clip bitrate ladders: three packaging runs over the same source, delivered over HLS and DASH under interchangeable ABR rules.",
} as const;

export const RESULTS_COPY = {
  title: "Results",
  description:
    "Ladder efficiency, codec tuning and playback telemetry across every clip in the catalogue.",
} as const;

export const CONCEPTS_COPY = {
  title: "Concepts",
  description:
    "The ideas this project measures, and where to see each of them on real data.",
} as const;

export const EDITOR_COPY = {
  title: "Editor",
  description:
    "Manage the clip catalogue: upload new sources, edit titles and descriptions, remove videos and their generated ladders.",
} as const;
