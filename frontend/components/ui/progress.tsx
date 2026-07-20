"use client"

import { cn } from "@/lib/utils"

type ProgressProps = {
  value: number
  className?: string
}

function Progress({ value, className }: ProgressProps) {
  const clampedValue = Math.min(100, Math.max(0, value))

  return (
    <div
      data-slot="progress"
      className={cn("bg-secondary h-3 w-full overflow-hidden rounded-full", className)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedValue}
      role="progressbar"
    >
      <div
        className="bg-primary h-full transition-[width] duration-300 ease-out"
        style={{ width: `${clampedValue}%` }}
      />
    </div>
  )
}

export { Progress }
