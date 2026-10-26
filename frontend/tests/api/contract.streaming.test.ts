import { describe, expect, it } from "vite-plus/test";

import { NETWORK_PROFILE_RATE_BPS } from "@/lib/benchmark/types";
import { tagRunRequest } from "@/lib/streamingConfig";
import { getVideoUrl } from "@/lib/streamingLabels";
import { getVideoTranscodes } from "@/lib/videoTranscodesApi";

import { checkDelivery } from "./support/checks";
import { apiUrl, backendUp, listRouteIds } from "./support/env";

const routeIds = await listRouteIds();

async function timedRange(url: string, bytes: number): Promise<number> {
  const started = performance.now();
  const res = await fetch(url, { headers: { Range: `bytes=0-${bytes - 1}` } });
  expect((await res.arrayBuffer()).byteLength).toBe(bytes);
  return (performance.now() - started) / 1000;
}

describe.skipIf(!backendUp || routeIds.length === 0)("network shaping", () => {
  // Every 3G and 4G result rests on the server actually holding a tagged run to its profile's rate.
  it("holds a request tagged with the 3G profile to its rate, and leaves untagged ones alone", async () => {
    const bytes = 500_000;
    const source = getVideoUrl("source", apiUrl, routeIds[0]);
    const shaped = tagRunRequest(source, { token: `api-test.${Date.now()}`, network: "threeG" });

    const floorSec = (bytes * 8) / (NETWORK_PROFILE_RATE_BPS.threeG as number);
    const shapedSec = await timedRange(shaped, bytes);
    const unshapedSec = await timedRange(source, bytes);

    expect(shapedSec, `${bytes} B at 3G took ${shapedSec.toFixed(2)} s`).toBeGreaterThanOrEqual(
      floorSec * 0.8,
    );
    expect(unshapedSec, "the same range unshaped").toBeLessThan(shapedSec / 3);
  });
});

describe.skipIf(!backendUp || routeIds.length === 0).each(routeIds)("delivery of %s", (routeId) => {
  it("serves every packaging run over HLS and DASH, and the source over byte ranges", async () => {
    await checkDelivery(routeId, await getVideoTranscodes(apiUrl, routeId));
  });

  it("lets the frontend's origin read media responses and the codec header", async () => {
    const res = await fetch(getVideoUrl("source", apiUrl, routeId), {
      method: "HEAD",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(res.headers.get("access-control-expose-headers") ?? "").toMatch(/X-Video-Codec/i);
  });
});
