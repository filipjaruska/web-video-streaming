import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A table or chart with its title above and an optional note on units and averaging below. */
export function Figure({
  title,
  note,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("min-w-0 space-y-3", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <span className="text-sm font-medium">{title}</span>
        {actions && <span className="flex items-center gap-2">{actions}</span>}
      </figcaption>
      {children}
      {note && <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>}
    </figure>
  );
}
