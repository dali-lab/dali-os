// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { PageBar } from "~/components/shell/PageBar";
import { PageBarSlotProvider } from "~/components/shell/page-bar-slot";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";
import { ToastProvider } from "~/components/ui/toast";
import * as openInDesktop from "~/lib/open-in-desktop";

vi.mock("~/components/page-docs/PageDocButton", () => ({ PageDocButton: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const star = { favorited: false, inSidebar: false, canToggle: true, toggle: async () => {} };

async function mount(flags: Record<string, boolean>) {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(FeatureFlagsProvider, {
            flags,
            children: createElement(PageBarSlotProvider, {
              children: createElement(PageBar, { tabs: false, star, onCopyLink: () => {} }),
            }),
          }),
        ),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/projects/a?x=1#h"] }));
  });
}

const button = () => container.querySelector('button[aria-label="Open in desktop app"]');

beforeEach(() => {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh) Chrome/120");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP;
  vi.restoreAllMocks();
});

describe("PageBar open in desktop app", () => {
  it("is present with the flag in a desktop browser, before Copy link", async () => {
    await mount({ "desktop-tabs": true });
    const labels = [...container.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(labels.indexOf("Open in desktop app")).toBeGreaterThan(-1);
    expect(labels.indexOf("Open in desktop app")).toBe(labels.indexOf("Copy link to this page") - 1);
  });

  it("is absent with the flag off", async () => {
    await mount({});
    expect(button()).toBeNull();
  });

  it("is absent inside the desktop app", async () => {
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    await mount({ "desktop-tabs": true });
    expect(button()).toBeNull();
  });

  it("is absent on mobile", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile");
    await mount({ "desktop-tabs": true });
    expect(button()).toBeNull();
  });

  it("opens the current path, search and hash", async () => {
    const open = vi.spyOn(openInDesktop, "openInDesktopApp").mockReturnValue(() => {});
    vi.spyOn(openInDesktop, "currentPagePath").mockReturnValue("/projects/a?x=1#h");
    await mount({ "desktop-tabs": true });
    act(() => {
      (button() as HTMLElement).click();
    });
    expect(open).toHaveBeenCalledWith("/projects/a?x=1#h", expect.objectContaining({ onFallback: expect.any(Function) }));
  });

  it("shows the download toast when the app does not open", async () => {
    vi.spyOn(openInDesktop, "openInDesktopApp").mockImplementation((_p, o) => {
      o.onFallback();
      return () => {};
    });
    await mount({ "desktop-tabs": true });
    await act(async () => {
      (button() as HTMLElement).click();
    });
    expect(document.body.textContent).toContain("The desktop app didn't open.");
    expect(document.body.textContent).toContain("Download");
  });
});
