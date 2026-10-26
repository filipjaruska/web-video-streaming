import { cn } from "@/lib/utils";

type Tone = "neutral" | "active" | "good" | "bad";

/**
 * Every status string the API sends (upload sessions, transcodes, analysis sections, clip states),
 * mapped once to a label and a tone, so the same state reads the same everywhere.
 */
const STATUS: Record<string, { label: string; tone: Tone }> = {
  awaitingupload: { label: "Waiting for file", tone: "neutral" },
  uploading: { label: "Uploading", tone: "active" },
  queued: { label: "Queued", tone: "neutral" },
  processing: { label: "Processing", tone: "active" },
  running: { label: "Running", tone: "active" },
  pending: { label: "Pending", tone: "neutral" },
  completed: { label: "Done", tone: "good" },
  succeeded: { label: "Done", tone: "good" },
  ready: { label: "Ready", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  expired: { label: "Expired", tone: "bad" },
};

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border text-muted-foreground",
  active: "border-primary/40 bg-primary/10 text-primary",
  good: "border-success/40 bg-success/10 text-success",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function statusLabel(status: string | null | undefined): string {
  return STATUS[(status ?? "").toLowerCase()]?.label ?? status ?? "Unknown";
}

export function StatusBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const entry = STATUS[(status ?? "").toLowerCase()] ?? {
    label: status ?? "Unknown",
    tone: "neutral" as const,
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[entry.tone],
        className,
      )}
    >
      {entry.tone === "active" && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      )}
      {entry.label}
    </span>
  );
}
