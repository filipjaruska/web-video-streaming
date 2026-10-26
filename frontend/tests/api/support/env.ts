/**
 * Where the API tests point and what they may do there.
 *
 * - `API_URL` picks the backend (default: the local dev backend). It is also what the frontend's own
 *   clients read, so both resolve the same server.
 * - Without a reachable backend the suites skip, unless one is required (`CI`, or writes enabled),
 *   in which case the run fails instead of silently testing nothing.
 * - `API_TESTS_WRITE=1` enables the upload end-to-end test. It creates, processes and deletes its own
 *   video, but it does write to the backend's database and occupies its processing queue — never set
 *   it against a backend whose data matters.
 * - `ACTION_PASSWORD`, when the backend has one, is sent with every request, and the password
 *   contract checks that protected endpoints refuse requests without it.
 */
export const apiUrl = (process.env.API_URL ?? "http://localhost:5000").replace(/\/$/, "");
process.env.API_URL = apiUrl;

export const writesEnabled = process.env.API_TESTS_WRITE === "1";
export const backendRequired = writesEnabled || !!process.env.CI;

async function probe(): Promise<boolean> {
  try {
    // The catalogue rather than /health, which older backends lack; the health check has a test of its own.
    const res = await fetch(`${apiUrl}/api/videos`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export const backendUp = await probe();

if (!backendUp && backendRequired) {
  throw new Error(`The API tests need a backend at ${apiUrl}, and none answered.`);
}

export const skipReason = backendUp ? null : `no backend at ${apiUrl}`;

/** Route ids of the videos the backend currently has, read once per test file. */
export async function listRouteIds(): Promise<string[]> {
  if (!backendUp) {
    return [];
  }
  const res = await fetch(`${apiUrl}/api/videos`, { cache: "no-store" });
  const body = (await res.json()) as { videos: Array<{ routeId: string }> };
  return body.videos.map((video) => video.routeId);
}

/**
 * The backend's password, when it has one: `ACTION_PASSWORD` here as on the backend. Sent on
 * every request; the backend only checks it where it protects an endpoint.
 */
export const actionPassword = process.env.ACTION_PASSWORD?.trim() || null;

export async function fetchOk(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (actionPassword) {
    headers.set("X-Action-Password", actionPassword);
  }
  const res = await fetch(path.startsWith("http") ? path : `${apiUrl}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} answered ${res.status}`);
  }
  return res;
}
