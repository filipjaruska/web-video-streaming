import { describe, it } from "vite-plus/test";

import { getVideoTranscodes } from "@/lib/videoTranscodesApi";

import { checkCors, checkDelivery, checkNetworkShaping } from "./support/checks";
import { apiUrl, backendUp, listRouteIds } from "./support/env";

// On a fresh backend (CI) there are no clips yet; e2e.upload.test.ts runs these same checks on the
// clip it uploads.
const routeIds = await listRouteIds();

describe.skipIf(!backendUp || routeIds.length === 0)("network shaping", () => {
  it("holds a request tagged with the 3G profile to its rate, and leaves untagged ones alone", async () => {
    await checkNetworkShaping(routeIds[0]);
  });
});

describe.skipIf(!backendUp || routeIds.length === 0).each(routeIds)("delivery of %s", (routeId) => {
  it("serves every packaging run over HLS and DASH, and the source over byte ranges", async () => {
    await checkDelivery(routeId, await getVideoTranscodes(apiUrl, routeId));
  });

  it("lets the frontend's origin read media responses and the codec header", async () => {
    await checkCors(routeId);
  });
});
