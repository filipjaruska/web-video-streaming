import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A table or chart with a caption above and an optional note below, laid out like the thesis:
 * "Table 6 — Derived ladders against the static ladder", then the object, then units and averaging.
 */
export function Figure({
  label,
  title,
  note,
  actions,
  children,
  className,
}: {
  /** e.g. "Table 6" or "Graph 2"; omitted on pages that do not follow the thesis numbering. */
  label?: string;
  title: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("min-w-0 space-y-3", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <span className="text-sm font-medium">
          {label && <span className="text-muted-foreground">{label} · </span>}
          {title}
        </span>
        {actions && <span className="flex items-center gap-2">{actions}</span>}
      </figcaption>
      {children}
      {note && <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>}
    </figure>
  );
}
