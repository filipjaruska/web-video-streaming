import type { ReactNode } from "react";

/** The panel every custom chart tooltip renders into. */
export function ChartTooltipBox({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-sm border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {title && <div className="mb-0.5 font-medium">{title}</div>}
      <div className="space-y-0.5 text-muted-foreground">{children}</div>
    </div>
  );
}
