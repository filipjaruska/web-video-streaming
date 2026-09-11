/**
 * Loads dash.js for Vidstack's DASH provider.
 *
 * Handing Vidstack `() => import("dashjs")` directly failed in two ways, both traced in production:
 *
 * 1. The bundler resolves `dashjs` to a build whose module namespace has no usable `default`.
 *    Vidstack's loader reads `.default`, throws `Error("")` and reports a fatal "failed to load
 *    dash.js" error — the "Playback failed" banner at every DASH start — and never creates its own
 *    dash.js instance. The `onInstance` hook in the player therefore never ran: no ABR driver, no
 *    fast start and no DASH statistics.
 * 2. Evaluating dash.js runs its auto-create: once the document has loaded, it scans for `<video>`
 *    elements holding a `<source type="application/dash+xml">` — which Vidstack adds for every
 *    DASH source — and starts a player of its own on them with default settings. That orphan is what
 *    actually played DASH, using dash.js's built-in ABR rather than the rules in `lib/abr`.
 *
 * Setting `window.dashjs.skipAutoCreate` before the module evaluates switches (2) off; dash.js
 * reuses an existing `window.dashjs` object instead of replacing it, so the flag survives. For (1)
 * the namespace is taken from whichever of the module's default export, the module itself or the
 * global actually carries `MediaPlayer`, and handed over in the `{ default }` shape Vidstack reads.
 */
type DashNamespace = { MediaPlayer: (...args: unknown[]) => unknown } & Record<string, unknown>;

function isDashNamespace(value: unknown): value is DashNamespace {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { MediaPlayer?: unknown }).MediaPlayer === "function"
  );
}

export async function loadDashLibrary(): Promise<{ default: DashNamespace }> {
  const scope = window as Window & { dashjs?: Record<string, unknown> };
  if (scope.dashjs) {
    scope.dashjs.skipAutoCreate = true;
  } else {
    scope.dashjs = { skipAutoCreate: true };
  }

  const module = (await import("dashjs")) as unknown as Record<string, unknown>;
  const namespace = [module.default, module, scope.dashjs].find(isDashNamespace);

  if (!namespace) {
    throw new Error("dash.js loaded without a MediaPlayer export");
  }

  return { default: namespace };
}
