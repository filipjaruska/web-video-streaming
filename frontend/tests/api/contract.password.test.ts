import { describe, expect, it } from "vite-plus/test";

import { actionPassword, apiUrl, backendUp } from "./support/env";

const unknownVideo = "no-such-video";
const unknownSession = "00000000-0000-0000-0000-000000000000";
const json = { "Content-Type": "application/json" };

/**
 * Every endpoint the backend protects, called with ids that do not exist, so none of them writes
 * anything whichever way the check goes. Creating an upload session is the exception: it writes
 * when unprotected, so it is only called when a password is set.
 */
const protectedRequests: Array<[string, string, RequestInit]> = [
  ["PATCH", `/api/uploadSessions/${unknownSession}/video`, { headers: json, body: "{}" }],
  ["POST", `/api/uploadSessions/${unknownSession}/upload`, {}],
  ["PATCH", `/api/videos/${unknownVideo}`, { headers: json, body: "{}" }],
  ["POST", `/api/videos/${unknownVideo}/ladders/dynamic/rederive`, {}],
  ["POST", `/api/videos/${unknownVideo}/ladders/dynamic/refine-grid`, {}],
  ["POST", `/api/videos/${unknownVideo}/comparisons/recompute`, {}],
  ["DELETE", `/api/videos/${unknownVideo}`, {}],
  ["POST", "/api/benchmarks", { headers: json, body: "{}" }],
  ["GET", "/api/database/export", {}],
];

async function status(method: string, path: string, init: RequestInit, password?: string) {
  const headers = new Headers(init.headers);
  if (password !== undefined) {
    headers.set("X-Action-Password", password);
  }
  return (await fetch(`${apiUrl}${path}`, { ...init, method, headers })).status;
}

describe.skipIf(!backendUp || !actionPassword)("password contract, password set", () => {
  it.each([
    ...protectedRequests,
    ["POST", "/api/uploadSessions", {}] as [string, string, RequestInit],
  ])("refuses %s %s without the password, or with a wrong one", async (method, path, init) => {
    expect(await status(method, path, init)).toBe(401);
    expect(await status(method, path, init, `${actionPassword}-wrong`)).toBe(401);
  });

  it("lets the right password through to the endpoint itself", async () => {
    expect(await status("DELETE", `/api/videos/${unknownVideo}`, {}, actionPassword!)).toBe(404);
  });

  it("keeps reading and streaming open", async () => {
    expect(await status("GET", "/api/videos", {})).toBe(200);
    expect(await status("GET", `/api/hls/${unknownVideo}/master.m3u8`, {})).toBe(404);
  });
});

describe.skipIf(!backendUp || !!actionPassword)("password contract, no password set", () => {
  it.each(protectedRequests)("lets %s %s through unchecked", async (method, path, init) => {
    expect(await status(method, path, init)).not.toBe(401);
  });
});
