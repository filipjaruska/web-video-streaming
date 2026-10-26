import { describe, expect, it } from "vite-plus/test";

import {
  NETWORK_PARAM,
  RUN_TOKEN_PARAM,
  benchmarkRunToken,
  tagRunRequest,
} from "@/lib/streamingConfig";
import { getHlsVariantUrl, getVideoUrl } from "@/lib/streamingLabels";

const api = "http://api.test";

describe("getVideoUrl", () => {
  it("plays the source over the byte-range endpoint, ignoring any transcode", () => {
    expect(getVideoUrl("source", api, "clip", "t1")).toBe(`${api}/api/httprange/clip`);
  });

  it("uses the active-ladder manifests without a transcode", () => {
    expect(getVideoUrl("hls", api, "clip")).toBe(`${api}/api/hls/clip/master.m3u8`);
    expect(getVideoUrl("dash", api, "clip", null)).toBe(`${api}/api/dash/clip/manifest.mpd`);
  });

  it("scopes the manifests to a packaging run when one is given", () => {
    expect(getVideoUrl("hls", api, "clip", "t1")).toBe(`${api}/api/hls/clip/t/t1/master.m3u8`);
    expect(getVideoUrl("dash", api, "clip", "t1")).toBe(`${api}/api/dash/clip/t/t1/manifest.mpd`);
  });
});

describe("getHlsVariantUrl", () => {
  it("addresses one rung's playlist, with or without a packaging run", () => {
    expect(getHlsVariantUrl(api, "clip", "360p")).toBe(`${api}/api/hls/clip/360p.m3u8`);
    expect(getHlsVariantUrl(api, "clip", "360p", "t1")).toBe(`${api}/api/hls/clip/t/t1/360p.m3u8`);
  });
});

describe("benchmarkRunToken", () => {
  it("is unique per run nonce within a page load", () => {
    expect(benchmarkRunToken(1)).not.toBe(benchmarkRunToken(2));
    expect(benchmarkRunToken(3)).toBe(benchmarkRunToken(3));
  });
});

describe("tagRunRequest", () => {
  const url = `${api}/api/hls/clip/master.m3u8`;

  it("leaves the URL alone outside a benchmark run", () => {
    expect(tagRunRequest(url, null)).toBe(url);
  });

  it("stamps the token and the profile the server shapes to", () => {
    const tagged = new URL(tagRunRequest(url, { token: "abc.1", network: "fourG" }));
    expect(tagged.searchParams.get(RUN_TOKEN_PARAM)).toBe("abc.1");
    expect(tagged.searchParams.get(NETWORK_PARAM)).toBe("fourG");
  });

  it("replaces a previous run's stamp instead of keeping it", () => {
    const first = tagRunRequest(url, { token: "abc.1", network: "threeG" });
    const second = new URL(tagRunRequest(first, { token: "abc.2", network: null }));
    expect(second.searchParams.getAll(RUN_TOKEN_PARAM)).toEqual(["abc.2"]);
    // The unshaped network carries no profile at all, so the old one must not survive.
    expect(second.searchParams.has(NETWORK_PARAM)).toBe(false);
  });

  it("keeps a segment URL's existing query intact", () => {
    const tagged = new URL(tagRunRequest(`${api}/seg.m4s?v=2`, { token: "t", network: null }));
    expect(tagged.searchParams.get("v")).toBe("2");
  });
});
