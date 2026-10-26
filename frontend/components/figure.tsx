import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A table or chart with its title and an optional description above, and an optional note on units
 * and averaging below.
 */
export function Figure({
  title,
  description,
  note,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  /** What the figure shows and how to read it, between the title and the figure. */
  description?: ReactNode;
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
      {description && (
        <p className="-mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {children}
      {note && <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>}
    </figure>
  );
}
