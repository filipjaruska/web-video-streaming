"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { segment: "", label: "Watch" },
  { segment: "results", label: "Results" },
  { segment: "benchmark", label: "Benchmark" },
  { segment: "raw", label: "Raw data" },
] as const;

export function VideoTabs({ routeId }: { routeId: string }) {
  const pathname = usePathname();
  const current = pathname.split("/")[2] ?? "";
  return (
    <nav aria-label="Video" className="-mb-px flex gap-1 overflow-x-auto border-b">
      {TABS.map((tab) => {
        const active = current === tab.segment;
        return (
          <Link
            key={tab.label}
            href={tab.segment ? `/${routeId}/${tab.segment}` : `/${routeId}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
