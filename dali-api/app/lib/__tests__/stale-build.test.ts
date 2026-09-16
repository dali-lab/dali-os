import { afterEach, describe, expect, it, vi } from "vitest";
import { isBuildStale, isChunkLoadError } from "~/lib/stale-build";

describe("isChunkLoadError", () => {
  it("recognises each browser's failed dynamic import message", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
  });

  it("ignores ordinary render errors", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("isBuildStale", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubWindow(version: string | undefined) {
    vi.stubGlobal("window", {
      location: { origin: "https://os.example" },
      __reactRouterManifest: version ? { version } : undefined,
    });
  }

  it("is stale when the manifest endpoint signals a version mismatch", async () => {
    stubWindow("abc123");
    const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toContain("version=abc123");
      return new Response(null, { status: 204, headers: { "X-Remix-Reload-Document": "true" } });
    });
    await expect(isBuildStale(fetchImpl as typeof fetch)).resolves.toBe(true);
  });

  it("is current when the manifest endpoint returns patches", async () => {
    stubWindow("abc123");
    const fetchImpl = vi.fn(async () => Response.json({}));
    await expect(isBuildStale(fetchImpl as typeof fetch)).resolves.toBe(false);
  });

  it("treats network failure or a missing manifest as not stale", async () => {
    stubWindow("abc123");
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(isBuildStale(failing as typeof fetch)).resolves.toBe(false);

    stubWindow(undefined);
    await expect(isBuildStale(failing as typeof fetch)).resolves.toBe(false);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
