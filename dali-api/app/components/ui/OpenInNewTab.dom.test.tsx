// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ desktopVersion: vi.fn(), error: vi.fn(), assign: vi.fn() }));
vi.mock("~/lib/desktop", () => ({ desktopVersion: m.desktopVersion }));
vi.mock("./toast", () => ({ useToast: () => Object.assign(vi.fn(), { error: m.error, success: vi.fn(), info: vi.fn() }) }));
vi.mock("./floating", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }));

import { OpenInNewTab } from "./OpenInNewTab";

let container: HTMLDivElement;
let root: Root;

function mount(props: Parameters<typeof OpenInNewTab>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(OpenInNewTab, props)));
  return container.querySelector("a")!;
}

const click = (a: HTMLAnchorElement) => {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => void a.dispatchEvent(e));
  return e;
};

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign: m.assign } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("OpenInNewTab", () => {
  it("opens a new browser tab in a browser", () => {
    m.desktopVersion.mockReturnValue(null);
    const externalHref = vi.fn();
    const a = mount({ href: "/files/a", externalHref });
    expect(a.getAttribute("href")).toBe("/files/a");
    expect(a.target).toBe("_blank");
    expect(click(a).defaultPrevented).toBe(false);
    expect(externalHref).not.toHaveBeenCalled();
  });

  it("sends the desktop app to the system browser instead of loading over the app", async () => {
    m.desktopVersion.mockReturnValue("1.4.0");
    const externalHref = vi.fn().mockResolvedValue("https://s3.example/a?sig=1");
    const a = mount({ href: "/files/a", externalHref });
    expect(click(a).defaultPrevented).toBe(true);
    await act(async () => {});
    expect(m.assign).toHaveBeenCalledWith("https://s3.example/a?sig=1");
  });

  it("says so when the desktop link can't be made", async () => {
    m.desktopVersion.mockReturnValue("1.4.0");
    const a = mount({ href: "/files/a", externalHref: vi.fn().mockRejectedValue(new Error("no")) });
    click(a);
    await act(async () => {});
    expect(m.assign).not.toHaveBeenCalled();
    expect(m.error).toHaveBeenCalledWith("The file couldn't be opened. Try again.");
  });

  it("falls back to the plain link in the desktop app without an external link", () => {
    m.desktopVersion.mockReturnValue("1.4.0");
    expect(click(mount({ href: "/files/a" })).defaultPrevented).toBe(false);
  });
});
