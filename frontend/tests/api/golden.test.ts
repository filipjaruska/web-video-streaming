import { createHash } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { getVideoUrl } from "@/lib/streamingLabels";
import type { VideoTranscodesResponse } from "@/lib/videoTranscodesApi";

import { apiUrl, backendUp, fetchOk, listRouteIds } from "./support/env";

/*
 * Golden snapshots: the raw responses as they are today, compared byte for byte (after sorting keys)
 * on every later run. The point is the backend refactor — anything it changes on the wire, down to a
 * renamed field, a null that became absent or a number serialised differently, shows up as a diff.
 *
 * Recorded with `vp run frontend#test:api:record`; on a first run the files are written automatically.
 * They live in tests/__golden__/, gitignored: they hold the videos' measurement data and only match the
 * database they were recorded from. Re-record after deliberately reprocessing a video or adding
 * benchmark runs. CI never runs this file; it has no goldens and a fresh database.
 */

const routeIds = await listRouteIds();
const golden = (...parts: string[]) => `../__golden__/${parts.join("/")}`;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

async function wireJson(path: string): Promise<string> {
  return `${JSON.stringify(sortKeys(await (await fetchOk(path)).json()), null, 2)}\n`;
}

async function text(url: string): Promise<string> {
  return (await (await fetchOk(url)).text()).replace(/^\uFEFF/, "");
}

async function fingerprint(url: string): Promise<string> {
  const bytes = Buffer.from(await (await fetchOk(url)).arrayBuffer());
  return `${bytes.byteLength} bytes, sha256 ${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Every manifest of a video, and a fingerprint of one segment per packaging run and protocol. */
async function delivery(routeId: string, transcodes: VideoTranscodesResponse): Promise<string> {
  const record: Record<string, string> = {};
  const runs: Array<string | null> = [
    null,
    ...transcodes.transcodes.filter((run) => run.status === "succeeded").map((run) => run.id),
  ];

  for (const run of runs) {
    const scope = run ?? "active";

    const masterUrl = getVideoUrl("hls", apiUrl, routeId, run);
    const master = await text(masterUrl);
    record[`hls/${scope}/master.m3u8`] = master;
    const variants = master.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
    for (const uri of variants) {
      record[`hls/${scope}/${uri}`] = await text(new URL(uri, masterUrl).toString());
    }
    const top = new URL(variants[0], masterUrl).toString();
    const firstSegment = record[`hls/${scope}/${variants[0]}`]
      .split(/\r?\n/)
      .find((line) => line && !line.startsWith("#"));
    if (firstSegment) {
      record[`hls/${scope}/first segment of ${variants[0]}`] = await fingerprint(
        new URL(firstSegment, top).toString(),
      );
    }

    const mpdUrl = getVideoUrl("dash", apiUrl, routeId, run);
    const mpd = await text(mpdUrl);
    record[`dash/${scope}/manifest.mpd`] = mpd;
    const template = /<SegmentTemplate\b[^>]*\bmedia="([^"]+)"[^>]*\bstartNumber="(\d+)"/.exec(mpd);
    const firstId = /<Representation\b[^>]*\bid="([^"]+)"/.exec(mpd)?.[1];
    if (template && firstId) {
      const media = template[1]
        .replaceAll("$RepresentationID$", firstId)
        .replace(/\$Number(?:%0(\d+)d)?\$/, (_, width: string | undefined) =>
          template[2].padStart(Number(width ?? 0), "0"),
        );
      record[`dash/${scope}/first segment of representation ${firstId}`] = await fingerprint(
        new URL(media, mpdUrl).toString(),
      );
    }
  }

  return `${JSON.stringify(record, null, 2)}\n`;
}

describe.skipIf(!backendUp || !!process.env.CI)("golden snapshots", () => {
  it("catalogue", async () => {
    await expect(await wireJson("/api/videos")).toMatchFileSnapshot(golden("videos.json"));
  });

  describe.each(routeIds)("video %s", (routeId) => {
    it("transcodes", async () => {
      await expect(await wireJson(`/api/videos/${routeId}/transcodes`)).toMatchFileSnapshot(
        golden(routeId, "transcodes.json"),
      );
    });

    it("analysis", async () => {
      await expect(await wireJson(`/api/videos/${routeId}/analysis`)).toMatchFileSnapshot(
        golden(routeId, "analysis.json"),
      );
    });

    it("benchmarks", async () => {
      await expect(await wireJson(`/api/videos/${routeId}/benchmarks`)).toMatchFileSnapshot(
        golden(routeId, "benchmarks.json"),
      );
    });

    it("subtitles", async () => {
      await expect(await wireJson(`/api/videos/${routeId}/subs`)).toMatchFileSnapshot(
        golden(routeId, "subs.json"),
      );
    });

    it("manifests and segments", async () => {
      const transcodes = (await (
        await fetchOk(`/api/videos/${routeId}/transcodes`)
      ).json()) as VideoTranscodesResponse;
      await expect(await delivery(routeId, transcodes)).toMatchFileSnapshot(
        golden(routeId, "delivery.json"),
      );
    });
  });
});
