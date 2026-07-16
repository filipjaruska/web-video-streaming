import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"

interface PageShellProps {
  title: string
  description?: string
  children: ReactNode
  breadcrumb?: ReactNode
  /** Optional header action — rendered once as a shadcn Button on the right */
  actionLabel?: string
}

export function PageShell({
  title,
  description,
  children,
  breadcrumb,
  actionLabel,
}: PageShellProps) {
  return (
    <div className="p-8 min-h-[calc(100vh-3.5rem)]">
      <div className="@container/page max-w-[1920px] mx-auto">
        {breadcrumb && <div className="mb-4">{breadcrumb}</div>}
        <header className="mb-8 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold mb-2 tracking-tight">{title}</h1>
            {description && <p className="text-muted-foreground">{description}</p>}
          </div>
          {actionLabel && (
            <Button type="button" variant="outline" className="shrink-0 self-center">
              {actionLabel}
            </Button>
          )}
        </header>
        {children}
      </div>
    </div>
  )
}
