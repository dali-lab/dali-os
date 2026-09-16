// Stale-build recovery for long-lived tabs (and the desktop app's webview).
//
// Every deploy ships a new Docker image whose build/client only holds the new
// hashed assets. A tab left open across a deploy keeps running the old bundle:
// its next lazy chunk import 404s, and its next loader revalidation hands old
// components data shaped by new loaders. Either one throws into the root
// ErrorBoundary as a generic "Something went wrong". React Router reloads on a
// failed *route module* import itself, but not for React.lazy chunks or for a
// render crash, so this module covers the rest:
//   - `isBuildStale()` asks the server whether our build is still current,
//     reusing React Router's own `/__manifest?version=` check (204 +
//     X-Remix-Reload-Document on a mismatch — no new endpoint needed).
//   - `reloadForNewBuild()` does a guarded full reload so a genuinely broken
//     build can't trap the page in a reload loop.

const RELOAD_GUARD_KEY = "dali-stale-build-reload";
const CHECK_TIMEOUT_MS = 4_000;

type ManifestWindow = Window & {
  __reactRouterManifest?: { version?: string };
};

export function currentBuildVersion(): string | null {
  if (typeof window === "undefined") return null;
  return (window as ManifestWindow).__reactRouterManifest?.version ?? null;
}

/** Messages browsers use when a dynamic import / module preload fails. */
const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari / WKWebView (desktop app)
  /Unable to preload CSS/i, // Vite preload helper
  /ChunkLoadError/i,
];

export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

/**
 * True when the server is running a different build than this page loaded.
 * Network failures and timeouts resolve false — being offline is not a new deploy.
 */
export async function isBuildStale(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const version = currentBuildVersion();
  if (!version) return false;
  try {
    const url = new URL("/__manifest", window.location.origin);
    url.searchParams.set("version", version);
    // Without `paths` the handler 400s even on a matching version.
    url.searchParams.set("paths", "/");
    const res = await fetchImpl(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return res.status === 204 && res.headers.has("X-Remix-Reload-Document");
  } catch {
    return false;
  }
}

/**
 * Full-document reload onto the new build, at most once per build version per
 * tab session. Returns false (and does nothing) if we already reloaded for this
 * version, so a caller can fall back to showing its error UI.
 */
export function reloadForNewBuild(): boolean {
  if (typeof window === "undefined") return false;
  const version = currentBuildVersion() ?? "unknown";
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY) === version) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, version);
  } catch {
    // Storage blocked — still reload; the fresh page has a new version anyway.
  }
  window.location.reload();
  return true;
}
