// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OpenInDesktopRedirect } from "~/components/shell/OpenInDesktopRedirect";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";
import * as openInDesktop from "~/lib/open-in-desktop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let open: ReturnType<typeof vi.spyOn>;
let fallback: () => void;

async function mount(flags: Record<string, boolean> = { "desktop-tabs": true }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(FeatureFlagsProvider, { flags, children: createElement(OpenInDesktopRedirect) }));
  });
}

beforeEach(() => {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh) Chrome/120");
  document.cookie = "dali_open_in_app=1; Path=/";
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/projects/a?x=1#h");
  open = vi.spyOn(openInDesktop, "openInDesktopApp").mockImplementation((_p, o) => {
    fallback = o.onFallback;
    return () => {};
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.cookie = "dali_open_in_app=; Max-Age=0; Path=/";
  delete (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP;
  vi.restoreAllMocks();
});

const text = () => document.body.textContent ?? "";
const buttonByText = (t: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent === t)!;

describe("OpenInDesktopRedirect", () => {
  it("opens the current page once and shows the overlay", async () => {
    await mount();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe("/projects/a?x=1#h");
    expect(text()).toContain("Opening in DALI OS…");
  });

  it("does nothing with the cookie off", async () => {
    document.cookie = "dali_open_in_app=0; Path=/";
    await mount();
    expect(open).not.toHaveBeenCalled();
    expect(text()).toBe("");
  });

  it("does nothing with the flag off", async () => {
    await mount({});
    expect(open).not.toHaveBeenCalled();
  });

  it("does nothing inside the desktop app", async () => {
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    await mount();
    expect(open).not.toHaveBeenCalled();
  });

  it("does nothing after Stay in browser was chosen in this tab", async () => {
    window.sessionStorage.setItem(openInDesktop.STAY_IN_BROWSER_KEY, "1");
    await mount();
    expect(open).not.toHaveBeenCalled();
  });

  it("does nothing on an excluded path", async () => {
    window.history.replaceState(null, "", "/settings/general");
    await mount();
    expect(open).not.toHaveBeenCalled();
  });

  it("Stay in browser closes the overlay and remembers it for the tab", async () => {
    await mount();
    act(() => buttonByText("Stay in browser").click());
    expect(text()).toBe("");
    expect(window.sessionStorage.getItem(openInDesktop.STAY_IN_BROWSER_KEY)).toBe("1");
  });

  it("offers Download when the app does not open", async () => {
    await mount();
    act(() => fallback());
    expect(text()).toContain("The desktop app didn't open.");
    expect(document.body.querySelector('a[href="/download"]')?.textContent).toBe("Download");
  });
});
