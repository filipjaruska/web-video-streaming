"use client";

import { usePlaybackCapabilities } from "@/hooks/usePlaybackCapabilities";
import { DataCell, DataRow, DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";

function YesNo({ value }: { value: boolean }) {
  return (
    <Badge variant={value ? "secondary" : "outline"}>{value ? "yes" : "no"}</Badge>
  );
}

/**
 * The capability probe, run live in whatever browser is reading the page.
 *
 * Included because it turns the protocol-selection section from a claim into a demonstration:
 * open the same page on a desktop browser and on an iPhone and the answers genuinely differ,
 * which is exactly why the player picks its protocol rather than hardcoding one.
 */
export function BrowserCapabilities() {
  const capabilities = usePlaybackCapabilities();

  if (!capabilities) {
    return (
      <p className="text-sm text-muted-foreground">Probing this browser…</p>
    );
  }

  const rows: Array<{ label: string; value: boolean; note: string }> = [
    {
      label: "Media Source Extensions",
      value: capabilities.mediaSource,
      note: "Required by dash.js, and by hls.js outside Safari.",
    },
    {
      label: "ManagedMediaSource",
      value: capabilities.managedMediaSource,
      note: "Apple's constrained MSE — the iOS 17+ path.",
    },
    {
      label: "Native HLS",
      value: capabilities.nativeHls,
      note: "Plays .m3u8 without any JavaScript library — used only where MSE is missing, since the browser then picks the quality itself.",
    },
    {
      label: "H.264 in MSE",
      value: capabilities.avcInMse,
      note: "Everything this project packages is AVC.",
    },
  ];

  // Same order as `pickDeliveryForLadder`: hls.js wherever MSE exists, because only then do the
  // project's own ABR rules choose the quality; native HLS only where there is no MSE at all.
  const chosen = capabilities.mseHls
    ? "HLS through hls.js"
    : capabilities.nativeHls
      ? "HLS, played natively"
      : capabilities.dash
        ? "DASH through dash.js"
        : "progressive download over HTTP Range";

  return (
    <div className="space-y-3">
      <DataTable headers={["Capability", "Supported", "Why it matters"]}>
        {rows.map((row) => (
          <DataRow key={row.label}>
            <DataCell mono={false}>{row.label}</DataCell>
            <DataCell mono={false}>
              <YesNo value={row.value} />
            </DataCell>
            <DataCell mono={false} last className="text-muted-foreground">
              {row.note}
            </DataCell>
          </DataRow>
        ))}
      </DataTable>
      <p className="text-sm text-muted-foreground">
        On this browser, Best mode would deliver <strong>{chosen}</strong>.
      </p>
    </div>
  );
}
