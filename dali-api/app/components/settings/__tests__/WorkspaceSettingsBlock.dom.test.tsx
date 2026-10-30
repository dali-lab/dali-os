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
  const radios = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Tabs"] [role="radio"]'));

  afterEach(() => {
    document.cookie = "dali_tabstrip=; Max-Age=0; Path=/";
  });

  it("browser with desktop-tabs: shows what tabs look like beside the download link", async () => {
    await mount({ "desktop-tabs": true });
    expect(container.textContent).toContain("Tabs are in the desktop app.");
    expect(container.querySelector('a[href="/download"]')?.textContent).toBe("Download");
    expect(container.querySelector('[data-tabs-preview="on"] [data-preview-tabs]')).not.toBeNull();
    expect(radios()).toHaveLength(0);
  });

  it("desktop app with desktop-tabs: picks between previewed Tabs and No tabs cards", async () => {
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    await mount({ "desktop-tabs": true });
    expect(container.textContent).not.toContain("Tabs are in the desktop app.");
    expect(radios().map((r) => r.textContent)).toEqual(["Tabs", "No tabs"]);
    expect(radios()[0]!.getAttribute("aria-checked")).toBe("true");
    expect(radios()[0]!.querySelector('[data-tabs-preview="on"] [data-preview-tabs]')).not.toBeNull();
    expect(radios()[1]!.querySelector('[data-tabs-preview="off"] [data-preview-tabs]')).toBeNull();
  });

  it("desktop app: choosing No tabs saves it for this device", async () => {
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    await mount({ "desktop-tabs": true });
    await act(async () => {
      radios()[1]!.click();
    });
    expect(document.cookie).toContain("dali_tabstrip=0");
    expect(radios()[1]!.getAttribute("aria-checked")).toBe("true");
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

describe("WorkspaceSettingsBlock Opening pages row", () => {
  const radios = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Opening pages"] [role="radio"]'));

  it("previews a page with no tabs for Single page and with tabs for Tabbed workspace", async () => {
    await mount({});
    const [single, tabbed] = radios();
    expect(single!.textContent).toContain("Single page");
    expect(single!.querySelector('[data-tabs-preview="off"]')).not.toBeNull();
    expect(single!.querySelector("[data-preview-tabs]")).toBeNull();
    expect(tabbed!.textContent).toContain("Tabbed workspace");
    expect(tabbed!.querySelector('[data-tabs-preview="on"] [data-preview-tabs]')).not.toBeNull();
  });

  it("is absent with desktop-tabs on", async () => {
    await mount({ "desktop-tabs": true });
    expect(radios()).toHaveLength(0);
  });
});
