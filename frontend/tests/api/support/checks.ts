import { expect } from "vite-plus/test";

import {
  pickAnimationTranscode,
  pickDynamicTranscode,
  pickSourceTarget,
  pickStaticTranscode,
  pickTranscodeTargets,
} from "@/lib/analysisTargets";
import { NETWORK_PROFILE_RATE_BPS } from "@/lib/benchmark/types";
import { tagRunRequest } from "@/lib/streamingConfig";
import { getVideoUrl, getHlsVariantUrl } from "@/lib/streamingLabels";
import { getVideoAnalysis, type VideoAnalysisResponse } from "@/lib/videoAnalysisApi";
import {
  getVideoBenchmarks,
  profileOf,
  type VideoBenchmarksResponse,
} from "@/lib/videoBenchmarksApi";
import { getVideoSubtitles } from "@/lib/videoSubtitlesApi";
import { getVideoTranscodes, type VideoTranscodesResponse } from "@/lib/videoTranscodesApi";

import { apiUrl, fetchOk } from "./env";
import {
  analysisResponse,
  benchmarksResponse,
  expectSchema,
  subtitlesResponse,
  transcodesResponse,
} from "./schemas";

/*
 * The checks one published clip has to pass, shared by the read suites (every clip the backend has)
 * and the upload end-to-end test (the clip it just processed). Every call goes through the frontend's
 * own client function, so these exercise the URLs and error handling the UI actually uses.
 */

const LADDER_KINDS = ["static", "dynamic", "animation"] as const;

export async function checkTranscodes(routeId: string): Promise<VideoTranscodesResponse> {
  const body = expectSchema(
    transcodesResponse,
    await getVideoTranscodes(apiUrl, routeId),
    "transcodes",
  );

  const active = body.transcodes.filter((run) => run.isActive);
  expect(active.length, "exactly one packaging run is active").toBe(1);
  expect(body.activeTranscodeId).toBe(active[0].id);

  for (const run of body.transcodes.filter((item) => item.status === "succeeded")) {
    expect(run.hasHls || run.hasDash, `run ${run.id} has a package`).toBe(true);
  }
  return body;
}

/** True when the pipeline finished all three packaging runs, so the full analysis can be required. */
export function isFullyProcessed(transcodes: VideoTranscodesResponse): boolean {
  const succeeded = transcodes.transcodes.filter((run) => run.status === "succeeded");
  return LADDER_KINDS.every((kind) => succeeded.some((run) => run.ladderKind === kind));
}

export async function checkAnalysis(
  routeId: string,
  requireComplete: boolean,
): Promise<VideoAnalysisResponse> {
  const body = expectSchema(analysisResponse, await getVideoAnalysis(apiUrl, routeId), "analysis");
  expect(body.routeId).toBe(routeId);

  const source = pickSourceTarget(body.targets);
  expect(source, "a source target").toBeDefined();
  if (!requireComplete || !source) {
    return body;
  }

  // What the analysis page and the results tables read; each is optional in the type, so a renamed
  // or dropped series would otherwise pass the schema silently.
  const siti = source.series.siti;
  expect(siti?.si.length, "source SI/TI frames").toBeGreaterThan(0);
  expect(siti?.ti.length).toBe(siti?.si.length);
  expect(source.series.sourceCambi, "source CAMBI").toBeTypeOf("number");
  expect(source.series.duplicateFrameShare, "duplicate frame share").toBeTypeOf("number");

  expect(pickTranscodeTargets(body.targets)).toHaveLength(3);
  for (const target of [
    pickStaticTranscode(body.targets),
    pickDynamicTranscode(body.targets),
    pickAnimationTranscode(body.targets),
  ]) {
    expect(target, "a target per packaging run").toBeDefined();
    expect(
      Object.keys(target?.series.vmafByFormat?.hls ?? {}).length,
      `${target?.label} HLS VMAF`,
    ).toBeGreaterThan(0);
    expect(
      Object.keys(target?.series.vmafByFormat?.dash ?? {}).length,
      `${target?.label} DASH VMAF`,
    ).toBeGreaterThan(0);
  }

  // Every derived artefact lives on the static run's report.
  const derived = pickStaticTranscode(body.targets)?.series;
  expect(derived?.encodeGrid?.length, "generic encode grid").toBeGreaterThan(0);
  expect(derived?.encodeGridAnimation?.length, "animation encode grid").toBeGreaterThan(0);
  expect(derived?.derivedLadder?.variants.length, "dynamic ladder rungs").toBeGreaterThan(0);
  expect(derived?.animationLadder?.variants.length, "animation ladder rungs").toBeGreaterThan(0);
  expect(derived?.ladderComparison?.ladders.map((ladder) => ladder.ladderKind).toSorted()).toEqual([
    "animation",
    "dynamic",
  ]);
  expect(derived?.tuningComparison, "tuning comparison").toBeDefined();
  return body;
}

export async function checkBenchmarks(routeId: string): Promise<VideoBenchmarksResponse> {
  const body = expectSchema(
    benchmarksResponse,
    await getVideoBenchmarks(apiUrl, routeId),
    "benchmarks",
  );
  expect(body.routeId).toBe(routeId);
  for (const aggregate of body.aggregates) {
    expect(["standard", "fourG", "threeG", "variable"]).toContain(profileOf(aggregate));
    // The source cell is the only one without a ladder.
    expect(["static", "dynamic", "animation", "source"]).toContain(aggregate.ladderKind);
  }
  return body;
}

export async function checkSubtitles(routeId: string): Promise<number> {
  const body = expectSchema(
    subtitlesResponse,
    await getVideoSubtitles(apiUrl, routeId),
    "subtitles",
  );
  for (const track of body.tracks) {
    const res = await fetchOk(track.url);
    expect(res.headers.get("content-type")).toMatch(/text\/vtt/);
    expect((await res.text()).replace(/^\uFEFF/, "")).toMatch(/^WEBVTT/);
  }
  return body.tracks.length;
}

export async function checkThumbnail(routeId: string): Promise<void> {
  const res = await fetchOk(`/api/videos/${routeId}/thumbnail`);
  expect(res.headers.get("content-type")).toMatch(/^image\//);
  expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
}

// —— Delivery ————————————————————————————————————————————————————————————————

function hlsUris(playlist: string): string[] {
  return playlist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const body = await (await fetchOk(url)).arrayBuffer();
  expect(body.byteLength, url).toBeGreaterThan(0);
  return body;
}

/** Master playlist → every variant → its init segment and first media segment. */
export async function checkHls(routeId: string, transcodeId: string | null): Promise<void> {
  const masterUrl = getVideoUrl("hls", apiUrl, routeId, transcodeId);
  const master = await (await fetchOk(masterUrl)).text();
  expect(master.startsWith("#EXTM3U")).toBe(true);
  expect(master).toContain("#EXT-X-STREAM-INF");

  const variants = hlsUris(master);
  expect(variants.length, "variant playlists").toBeGreaterThan(0);

  for (const uri of variants) {
    const variantUrl = new URL(uri, masterUrl).toString();
    if (/^\d+p\.m3u8$/.test(uri)) {
      // The single-rung builder the SI/TI preview uses must address the same playlist.
      expect(getHlsVariantUrl(apiUrl, routeId, uri.replace(".m3u8", ""), transcodeId)).toBe(
        variantUrl,
      );
    }
    const playlist = await (await fetchOk(variantUrl)).text();
    expect(playlist).toContain("#EXT-X-ENDLIST");
    const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(playlist)?.[1];
    if (init) {
      await fetchBytes(new URL(init, variantUrl).toString());
    }
    await fetchBytes(new URL(hlsUris(playlist)[0], variantUrl).toString());
  }
}

/** MPD → every representation's init segment and first media segment. */
export async function checkDash(routeId: string, transcodeId: string | null): Promise<void> {
  const mpdUrl = getVideoUrl("dash", apiUrl, routeId, transcodeId);
  const mpd = (await (await fetchOk(mpdUrl)).text()).replace(/^\uFEFF/, "");
  expect(mpd).toMatch(/<MPD[\s>]/);
  expect(mpd).toContain("<AdaptationSet");

  const representations = [
    ...mpd.matchAll(/<Representation\b[^>]*\bid="([^"]+)"[\s\S]*?<SegmentTemplate\b([^>]*)>/g),
  ];
  expect(representations.length, "representations").toBeGreaterThan(0);

  for (const [, id, template] of representations) {
    const attr = (name: string) => new RegExp(`${name}="([^"]+)"`).exec(template)?.[1];
    const fill = (pattern: string) =>
      pattern
        .replaceAll("$RepresentationID$", id)
        .replace(/\$Number(?:%0(\d+)d)?\$/, (_, width: string | undefined) =>
          (attr("startNumber") ?? "1").padStart(Number(width ?? 0), "0"),
        );
    await fetchBytes(new URL(fill(attr("initialization") ?? ""), mpdUrl).toString());
    await fetchBytes(new URL(fill(attr("media") ?? ""), mpdUrl).toString());
  }
}

/** The source file over HTTP Range, as the progressive player and the bitrate probe use it. */
export async function checkByteRange(routeId: string): Promise<void> {
  const url = getVideoUrl("source", apiUrl, routeId);

  const head = await fetchOk(url, { method: "HEAD" });
  expect(Number(head.headers.get("content-length")), "HEAD Content-Length").toBeGreaterThan(0);
  expect(head.headers.get("accept-ranges")).toBe("bytes");

  const res = await fetch(url, { headers: { Range: "bytes=0-1023" } });
  expect(res.status).toBe(206);
  expect(res.headers.get("content-range")).toMatch(/^bytes 0-1023\/\d+$/);
  expect((await res.arrayBuffer()).byteLength).toBe(1024);
}

/** Every delivery path of a clip: each packaging run over both protocols, and the source. */
export async function checkDelivery(
  routeId: string,
  transcodes: VideoTranscodesResponse,
): Promise<void> {
  await checkHls(routeId, null);
  await checkDash(routeId, null);
  for (const run of transcodes.transcodes.filter((item) => item.status === "succeeded")) {
    if (run.hasHls) {
      await checkHls(routeId, run.id);
    }
    if (run.hasDash) {
      await checkDash(routeId, run.id);
    }
  }
  await checkByteRange(routeId);
}

/** The frontend's origin may read media responses, including the codec header the player reports. */
export async function checkCors(routeId: string): Promise<void> {
  const res = await fetch(getVideoUrl("source", apiUrl, routeId), {
    method: "HEAD",
    headers: { Origin: "http://localhost:3000" },
  });
  expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  expect(res.headers.get("access-control-expose-headers") ?? "").toMatch(/X-Video-Codec/i);
}

async function timedRange(url: string, bytes: number): Promise<number> {
  const started = performance.now();
  const res = await fetch(url, { headers: { Range: `bytes=0-${bytes - 1}` } });
  expect((await res.arrayBuffer()).byteLength).toBe(bytes);
  return (performance.now() - started) / 1000;
}

/**
 * A request tagged with the 3G profile is held to its rate; the same request untagged is not.
 * Every 3G and 4G result rests on the server actually shaping a tagged run.
 */
export async function checkNetworkShaping(routeId: string): Promise<void> {
  const source = getVideoUrl("source", apiUrl, routeId);
  const size = Number((await fetchOk(source, { method: "HEAD" })).headers.get("content-length"));
  const bytes = Math.min(500_000, size);
  const shaped = tagRunRequest(source, { token: `api-test.${Date.now()}`, network: "threeG" });

  const floorSec = (bytes * 8) / (NETWORK_PROFILE_RATE_BPS.threeG as number);
  const shapedSec = await timedRange(shaped, bytes);
  const unshapedSec = await timedRange(source, bytes);

  expect(shapedSec, `${bytes} B at 3G took ${shapedSec.toFixed(2)} s`).toBeGreaterThanOrEqual(
    floorSec * 0.8,
  );
  expect(unshapedSec, "the same range unshaped").toBeLessThan(shapedSec / 3);
}

async function statusOf(path: string, init?: RequestInit): Promise<number> {
  return (await fetch(`${apiUrl}${path}`, init)).status;
}

/** What an existing clip answers for runs, rungs and files it does not have, and for hostile names. */
export async function checkClipErrors(routeId: string): Promise<void> {
  for (const path of [
    `/api/hls/${routeId}/t/no-such-run/master.m3u8`,
    `/api/dash/${routeId}/t/no-such-run/manifest.mpd`,
    `/api/hls/${routeId}/no-such-rung.m3u8`,
    `/api/videos/${routeId}/subs/no-such-track.vtt`,
  ]) {
    expect(await statusOf(path), `unknown run, rung or track: ${path}`).toBe(404);
  }

  for (const path of [
    `/api/hls/${routeId}/..%2f..%2fapp.db`,
    `/api/dash/${routeId}/..%2F..%2Fapp.db`,
    `/api/hls/${routeId}/%2e%2e%5capp.db`,
    `/api/videos/${routeId}/subs/..%2f..%2fapp.db`,
  ]) {
    const code = await statusOf(path);
    // Refused as a client error, never served and never a crash.
    expect(code >= 400 && code < 500, `path traversal ${path} answered ${code}`).toBe(true);
  }

  const url = getVideoUrl("source", apiUrl, routeId);
  const pastEnd = await fetch(url, { headers: { Range: "bytes=999999999999-" } });
  expect(pastEnd.status, "byte range past the end of the file").toBe(416);
}
