import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** What a block shows before its data exists. One line; a second only when it says when to expect it. */
export function EmptyState({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-dashed px-4 py-6 text-sm", className)}>
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 text-muted-foreground">{children}</p>}
    </div>
  );
}
