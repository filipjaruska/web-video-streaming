import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** The page column every route and the header share, so their edges line up. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8", className)}>
      {children}
    </div>
  );
}

interface PageShellProps {
  title: ReactNode;
  description?: ReactNode;
  /** Small line above the title, e.g. the section a page belongs to. */
  eyebrow?: ReactNode;
  /** Buttons or menus on the right of the title. */
  actions?: ReactNode;
  /** Rendered under the title row, e.g. the tab bar of a clip. */
  below?: ReactNode;
  children: ReactNode;
  /** @deprecated Pages being redesigned still pass these; removed once the last one is rewritten. */
  breadcrumb?: ReactNode;
  /** @deprecated Use `actions`. */
  action?: ReactNode;
}

export function PageShell({
  title,
  description,
  eyebrow,
  actions,
  below,
  children,
  breadcrumb,
  action,
}: PageShellProps) {
  const headerActions = actions ?? action;
  return (
    <main className="@container/page pb-16">
      <Container>
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-8 pb-6">
          <div className="min-w-0 space-y-1.5">
            {breadcrumb && <div className="mb-2">{breadcrumb}</div>}
            {eyebrow && <div className="text-xs font-medium text-muted-foreground">{eyebrow}</div>}
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
            {description && (
              <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">{description}</p>
            )}
          </div>
          {headerActions && <div className="flex shrink-0 items-center gap-2">{headerActions}</div>}
        </header>
        {below}
        <div className="animate-rise">{children}</div>
      </Container>
    </main>
  );
}
