// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { useDesktopHint, DESKTOP_HINT_SESSION_KEY } from "~/components/shell/useDesktopHint";
import { ToastProvider } from "~/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const dismiss = vi.fn();

function Probe({ enabled, dismissed }: { enabled: boolean; dismissed: boolean }) {
  useDesktopHint({ enabled, dismissed });
  return createElement(
    "div",
    null,
    createElement("a", { id: "internal", href: "/projects" }, "internal"),
    createElement("a", { id: "external", href: "https://example.com/x" }, "external"),
  );
}

async function mount(props: { enabled?: boolean; dismissed?: boolean } = {}) {
  dismiss.mockReset();
  dismiss.mockResolvedValue({ ok: true });
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(Probe, { enabled: props.enabled ?? true, dismissed: props.dismissed ?? false }),
        ),
    },
    { path: "/api/desktop-hint/dismiss", action: dismiss },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

function click(id: string, init: MouseEventInit = {}) {
  const el = container.querySelector<HTMLElement>(`#${id}`)!;
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

const hintShown = () => document.body.textContent?.includes("Tabs work in the desktop app.") ?? false;

beforeEach(() => {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh) Chrome/120");
  window.sessionStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP;
  vi.restoreAllMocks();
});

describe("useDesktopHint", () => {
  it("shows on a meta-click of an internal link without blocking the click", async () => {
    await mount();
    const ev = click("internal", { metaKey: true });
    expect(hintShown()).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("also fires on ctrl-click", async () => {
    await mount();
    click("internal", { ctrlKey: true });
    expect(hintShown()).toBe(true);
  });

  it("ignores plain clicks", async () => {
    await mount();
    click("internal");
    expect(hintShown()).toBe(false);
  });

  it("ignores external links", async () => {
    await mount();
    click("external", { metaKey: true });
    expect(hintShown()).toBe(false);
  });

  it("shows at most once per session", async () => {
    await mount();
    click("internal", { metaKey: true });
    expect(window.sessionStorage.getItem(DESKTOP_HINT_SESSION_KEY)).toBe("1");
    const first = document.body.querySelectorAll("[role=status], [role=alert]").length;
    click("internal", { metaKey: true });
    expect(document.body.querySelectorAll("[role=status], [role=alert]").length).toBe(first);
  });

  it("does not show when already dismissed", async () => {
    await mount({ dismissed: true });
    click("internal", { metaKey: true });
    expect(hintShown()).toBe(false);
  });

  it("does not show when disabled", async () => {
    await mount({ enabled: false });
    click("internal", { metaKey: true });
    expect(hintShown()).toBe(false);
  });

  it("does not show inside the desktop app", async () => {
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    await mount();
    click("internal", { metaKey: true });
    expect(hintShown()).toBe(false);
  });

  it("does not show on mobile", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone) Mobile");
    await mount();
    click("internal", { metaKey: true });
    expect(hintShown()).toBe(false);
  });

  it("Don't show again posts to the dismiss endpoint", async () => {
    await mount();
    click("internal", { metaKey: true });
    const btn = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Don't show again")!;
    await act(async () => {
      btn.click();
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("offers a Download action", async () => {
    await mount();
    click("internal", { metaKey: true });
    const labels = [...document.body.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toContain("Download");
  });
});
