import { afterEach, describe, expect, it, vi } from "vitest";
import { loader } from "../api.desktop.version";

afterEach(() => vi.unstubAllEnvs());

const run = async () => (await loader({} as never)).json();

describe("GET /api/desktop/version", () => {
  it("falls back to 0.0.0 and null links when nothing is set", async () => {
    for (const k of ["DESKTOP_MIN_VERSION", "DESKTOP_LATEST_VERSION", "DESKTOP_DOWNLOAD_URL", "DESKTOP_NOTES_URL"]) {
      vi.stubEnv(k, undefined);
    }
    expect(await run()).toEqual({ minVersion: "0.0.0", latestVersion: "0.0.0", downloadUrl: null, notesUrl: null });
  });

  it("returns the configured values", async () => {
    vi.stubEnv("DESKTOP_MIN_VERSION", "1.2.0");
    vi.stubEnv("DESKTOP_LATEST_VERSION", "1.3.0");
    vi.stubEnv("DESKTOP_DOWNLOAD_URL", "https://example.edu/dl");
    vi.stubEnv("DESKTOP_NOTES_URL", "https://example.edu/notes");
    expect(await run()).toEqual({
      minVersion: "1.2.0",
      latestVersion: "1.3.0",
      downloadUrl: "https://example.edu/dl",
      notesUrl: "https://example.edu/notes",
    });
  });
});
