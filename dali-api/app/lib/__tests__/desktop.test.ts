import { describe, expect, it, vi, afterEach } from "vitest";
import { desktopVersion } from "../desktop";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktopVersion", () => {
  it("reads the shell global from the top frame", () => {
    const top = { __DALI_DESKTOP: { version: "0.1.2" } };
    vi.stubGlobal("window", { top });
    expect(desktopVersion()).toBe("0.1.2");
  });

  it("returns null in a plain browser", () => {
    const top = {};
    vi.stubGlobal("window", { top });
    expect(desktopVersion()).toBeNull();
  });

  it("returns null when top is cross-origin and throws", () => {
    vi.stubGlobal("window", {
      get top(): Window {
        throw new Error("cross-origin");
      },
    });
    expect(desktopVersion()).toBeNull();
  });
});
