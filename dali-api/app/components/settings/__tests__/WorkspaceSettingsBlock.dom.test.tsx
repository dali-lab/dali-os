// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { WorkspaceSettingsBlock } from "~/components/settings/WorkspaceSettingsBlock";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";
import { ToastProvider } from "~/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(flags: Record<string, boolean>) {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(FeatureFlagsProvider, { flags, children: createElement(WorkspaceSettingsBlock) }),
        ),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

beforeEach(() => {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh) Chrome/120");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP;
  vi.restoreAllMocks();
});

describe("WorkspaceSettingsBlock Tabs row", () => {
  it("browser with desktop-tabs: links to the download page", async () => {
    await mount({ "desktop-tabs": true });
    expect(container.textContent).toContain("Tabs are in the desktop app.");
    expect(container.querySelector('a[href="/download"]')?.textContent).toBe("Download");
    expect(container.querySelector('input[aria-label="Tabs"]')).toBeNull();
  });

  it("desktop app with desktop-tabs: shows the toggle instead", async () => {
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    await mount({ "desktop-tabs": true });
    expect(container.textContent).not.toContain("Tabs are in the desktop app.");
    expect(container.querySelector('[aria-label="Tabs"]')).not.toBeNull();
  });

  it("flag off: no Tabs row in a browser", async () => {
    await mount({});
    expect(container.textContent).not.toContain("Tabs are in the desktop app.");
    expect(container.querySelector('a[href="/download"]')).toBeNull();
  });

  it("mobile: no Tabs row", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone) Mobile");
    await mount({ "desktop-tabs": true });
    expect(container.textContent).not.toContain("Tabs are in the desktop app.");
  });
});
