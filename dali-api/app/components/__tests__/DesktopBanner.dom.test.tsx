// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DesktopBanner } from "~/components/DesktopBanner";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(flags: Record<string, boolean> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(FeatureFlagsProvider, { flags, children: createElement(DesktopBanner) }));
  });
}

beforeEach(() => {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh) Chrome/120");
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP;
  vi.restoreAllMocks();
});

describe("DesktopBanner", () => {
  it("renders nothing inside the desktop app", async () => {
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    await mount({ "desktop-tabs": true });
    expect(container.textContent).toBe("");
  });

  it("flag off: only Open in app, no explanation", async () => {
    await mount();
    expect(container.textContent).toContain("Open in app");
    expect(container.querySelector('a[href="/download"]')).toBeNull();
    expect(container.textContent).not.toContain("Get the DALI OS desktop app");
  });

  it("flag on: explains the app and offers Download up front", async () => {
    await mount({ "desktop-tabs": true });
    expect(container.textContent).toContain("Get the DALI OS desktop app for tabs and native notifications.");
    expect(container.querySelector('a[href="/download"]')?.textContent).toContain("Download");
    expect(container.textContent).toContain("Open in app");
  });

  it("stays hidden once dismissed", async () => {
    window.localStorage.setItem("dali:desktop-banner:dismissed", "1");
    await mount({ "desktop-tabs": true });
    expect(container.textContent).toBe("");
  });
});
