"use client";

import type { AnalysisTarget } from "@/lib/videoAnalysisApi";
import { formatTargetStatus } from "@/lib/analysisLabels";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface TranscodeScaffoldCardProps {
  target: AnalysisTarget;
}

const FALLBACK_CHECKS = [
  { id: "hls-1080p", label: "HLS 1080p probe" },
  { id: "hls-360p", label: "HLS 360p probe" },
  { id: "dash", label: "DASH manifest / segments" },
];

export function TranscodeScaffoldCard({ target }: TranscodeScaffoldCardProps) {
  const checks =
    target.tree.children.length > 0
      ? target.tree.children.map((child) => ({
          id: child.id,
          label: child.label,
          note: child.meta?.error,
        }))
      : FALLBACK_CHECKS.map((item) => ({ ...item, note: undefined as string | undefined }));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{target.label}</CardTitle>
            <CardDescription>
              Planned probes for HLS/DASH outputs. Not implemented yet.
            </CardDescription>
          </div>
          <Badge variant="outline">{formatTargetStatus(target.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {checks.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-muted-foreground/50" />
              {item.label}
              {item.note && (
                <span className="text-xs text-muted-foreground/80">— {item.note}</span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
