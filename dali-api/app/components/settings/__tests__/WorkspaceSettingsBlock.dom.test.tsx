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

describe("WorkspaceSettingsBlock open links row", () => {
  const toggle = () => container.querySelector<HTMLInputElement>('input[aria-label="Open links in the desktop app"]');

  afterEach(() => {
    document.cookie = "dali_open_in_app=; Max-Age=0; Path=/";
  });

  it("browser with desktop-tabs: renders the toggle with its help text", async () => {
    await mount({ "desktop-tabs": true });
    expect(toggle()).not.toBeNull();
    expect(container.textContent).toContain("Links you open in this browser go to the app. Saved on this browser.");
  });

  it("writes the cookie when toggled", async () => {
    await mount({ "desktop-tabs": true });
    await act(async () => {
      toggle()!.click();
    });
    expect(document.cookie).toContain("dali_open_in_app=1");
    expect(toggle()!.checked).toBe(true);
    await act(async () => {
      toggle()!.click();
    });
    expect(document.cookie).toContain("dali_open_in_app=0");
  });

  it("reflects an existing cookie", async () => {
    document.cookie = "dali_open_in_app=1; Path=/";
    await mount({ "desktop-tabs": true });
    expect(toggle()!.checked).toBe(true);
  });

  it("is absent with the flag off", async () => {
    await mount({});
    expect(toggle()).toBeNull();
  });

  it("is absent inside the desktop app", async () => {
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    await mount({ "desktop-tabs": true });
    expect(toggle()).toBeNull();
  });

  it("is absent on mobile", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile");
    await mount({ "desktop-tabs": true });
    expect(toggle()).toBeNull();
  });
});
