import type { NextConfig } from "next";

/** Old analysis tabs, mapped to the section of the clip's Results tab that replaced each. */
const ANALYSIS_TAB_SECTIONS = ["content", "ladder", "tuning", "cost"] as const;

const nextConfig: NextConfig = {
  compress: true,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // Links from before the redesign (bookmarks, the thesis, shared URLs) keep working.
  async redirects() {
    return [
      { source: "/concepts", destination: "/method", permanent: true },
      { source: "/editor", destination: "/", permanent: true },
      ...ANALYSIS_TAB_SECTIONS.map((section) => ({
        source: "/:video/analysis",
        has: [{ type: "query" as const, key: "tab", value: section }],
        destination: `/:video/results#${section}`,
        permanent: true,
      })),
      {
        source: "/:video/analysis",
        has: [{ type: "query" as const, key: "tab", value: "delivery" }],
        destination: "/:video/results#vmaf",
        permanent: true,
      },
      {
        source: "/:video/analysis",
        has: [{ type: "query" as const, key: "tab", value: "raw" }],
        destination: "/:video/raw",
        permanent: true,
      },
      { source: "/:video/analysis", destination: "/:video/results", permanent: true },
    ];
  },
};

export default nextConfig;
