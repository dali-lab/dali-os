// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, Link, useLocation } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Mod = {
  hook: typeof import("~/components/DesktopTabs");
  store: typeof import("~/lib/desktop-tabs-store");
};

let container: HTMLDivElement;
let root: Root;
let mod: Mod;
let location = "";

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

async function mount(opts: { enabled?: boolean; desktop?: boolean; at?: string } = {}) {
  vi.resetModules();
  mod = {
    hook: await import("~/components/DesktopTabs"),
    store: await import("~/lib/desktop-tabs-store"),
  };
  if (opts.desktop !== false) {
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
  }
  function Shell() {
    const show = mod.hook.useDesktopTabs(opts.enabled !== false, false);
    location = useLocation().pathname + useLocation().search;
    return createElement(
      "div",
      null,
      createElement("span", { "data-testid": "show" }, String(show)),
      createElement(Link, { to: "/a/deeper", id: "deeper" }, "deeper"),
    );
  }
  const Stub = createRoutesStub([{ path: "*", Component: Shell }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: [opts.at ?? "/a"] }));
  });
  await flush();
}

const shown = () => container.querySelector('[data-testid="show"]')?.textContent;
const tabs = () => mod.store.getTabsSnapshot().tabs.map((t) => t.url);

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "dali_tabstrip=; Max-Age=0; Path=/";
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  document.title = "Alpha · DALI OS";
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP;
});

describe("useDesktopTabs", () => {
  it("never shows tabs in a browser", async () => {
    await mount({ desktop: false });
    expect(shown()).toBe("false");
    expect(mod.store.tabsActive()).toBe(false);
  });

  it("stays off without the flag", async () => {
    await mount({ enabled: false });
    expect(shown()).toBe("false");
  });

  it("is on by default in the desktop app and remembers that for the server", async () => {
    await mount();
    expect(shown()).toBe("true");
    expect(document.cookie).toContain("dali_tabstrip=1");
    expect(tabs()).toEqual(["/a"]);
  });

  it("stays off when the user turned tabs off", async () => {
    document.cookie = "dali_tabstrip=0; Path=/";
    await mount();
    expect(shown()).toBe("false");
  });

  it("records page navigation in the active tab and labels it from the title", async () => {
    await mount();
    document.title = "Deeper page · DALI OS";
    await act(async () => {
      (container.querySelector("#deeper") as HTMLAnchorElement).click();
    });
    await flush();
    const tab = mod.store.getTabsSnapshot().tabs[0];
    expect(tab).toMatchObject({ url: "/a/deeper", backStack: ["/a"], label: "Deeper page" });
  });

  it("switching tabs moves the router", async () => {
    await mount();
    await act(async () => {
      mod.store.tabActions.open({ url: "/b?x=1", label: "B" });
    });
    await flush();
    expect(location).toBe("/b?x=1");
    await act(async () => {
      mod.store.tabActions.activateIndex(0);
    });
    await flush();
    expect(location).toBe("/a");
  });

  it("handles the desktop menu's tab commands and tells the shell it did", async () => {
    await mount();
    const send = (command: string) => {
      const e = new CustomEvent(mod.hook.TAB_COMMAND_EVENT, { detail: { command }, cancelable: true });
      return window.dispatchEvent(e);
    };
    let unhandled = true;
    await act(async () => {
      unhandled = send("new");
    });
    await flush();
    expect(unhandled).toBe(false);
    expect(tabs()).toEqual(["/a", "/"]);
    await act(async () => {
      send("close");
    });
    await flush();
    expect(tabs()).toEqual(["/a"]);
    await act(async () => {
      send("reopen");
    });
    expect(tabs()).toEqual(["/a", "/"]);
    expect(send("bogus")).toBe(true);
  });

  it("switches tabs by number and closes with ⌘⇧K", async () => {
    await mount();
    await act(async () => {
      mod.store.tabActions.open({ url: "/b", label: "B" });
    });
    await flush();
    const key = (init: KeyboardEventInit) =>
      window.dispatchEvent(new KeyboardEvent("keydown", { metaKey: true, cancelable: true, ...init }));
    await act(async () => {
      key({ key: "1" });
    });
    await flush();
    expect(location).toBe("/a");
    await act(async () => {
      key({ key: "K", shiftKey: true });
    });
    await flush();
    expect(tabs()).toEqual(["/b"]);
    expect(location).toBe("/b");
  });
});
