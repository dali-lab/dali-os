// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { isBrowserDesktopCandidate, useIsBrowserDesktopCandidate } from "~/lib/desktop-candidate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

function setUA(ua: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
}

afterEach(() => {
  delete (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP;
  vi.restoreAllMocks();
});

describe("isBrowserDesktopCandidate", () => {
  it("is true in a desktop browser", () => {
    setUA(DESKTOP_UA);
    expect(isBrowserDesktopCandidate()).toBe(true);
  });

  it("is false inside the desktop app", () => {
    setUA(DESKTOP_UA);
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    expect(isBrowserDesktopCandidate()).toBe(false);
  });

  it("is false on mobile", () => {
    setUA(IPHONE_UA);
    expect(isBrowserDesktopCandidate()).toBe(false);
  });
});

describe("useIsBrowserDesktopCandidate", () => {
  async function render() {
    setUA(DESKTOP_UA);
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useIsBrowserDesktopCandidate());
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Probe));
    });
    act(() => root.unmount());
    return seen;
  }

  it("starts false so hydration matches, then settles true in a browser", async () => {
    const seen = await render();
    expect(seen[0]).toBe(false);
    expect(seen.at(-1)).toBe(true);
  });
});
