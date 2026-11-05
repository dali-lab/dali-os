import { describe, expect, it, vi, afterEach } from "vitest";
import { desktopVersion, hasNativeRecorder } from "../desktop";

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

describe("hasNativeRecorder", () => {
  const shell = { top: { __DALI_DESKTOP: { version: "0.1.21" } } };

  it("is true in the macOS shell", () => {
    vi.stubGlobal("window", shell);
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(hasNativeRecorder()).toBe(true);
  });

  it.each(["Win32", "Linux x86_64"])("is false in the %s shell", (platform) => {
    vi.stubGlobal("window", shell);
    vi.stubGlobal("navigator", { platform });
    expect(hasNativeRecorder()).toBe(false);
  });

  it("is false in a Mac browser", () => {
    vi.stubGlobal("window", { top: {} });
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(hasNativeRecorder()).toBe(false);
  });
});
