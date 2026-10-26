import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A titled block of a page, separated from the one above by a rule. */
export function Section({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn("scroll-mt-20 border-t py-8 first:border-t-0 first:pt-2", className)}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="space-y-8">{children}</div>
    </section>
  );
}
