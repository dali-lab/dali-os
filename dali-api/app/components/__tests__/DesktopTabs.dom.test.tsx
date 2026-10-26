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

async function mount(opts: { enabled?: boolean; desktop?: boolean; at?: string; emojiAt?: Record<string, string> } = {}) {
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
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: Shell,
      loader: ({ request }: { request: Request }) => ({ emoji: opts.emojiAt?.[new URL(request.url).pathname] ?? null }),
      handle: {
        breadcrumb: (data: { emoji: string | null }) => (data.emoji ? [{ label: "Page", emoji: data.emoji }] : null),
      },
    },
  ]);
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

  it("gives the tab the page's emoji and drops it on a page without one", async () => {
    await mount({ emojiAt: { "/a": "🌲" } });
    const active = () => mod.store.getTabsSnapshot().tabs.find((t) => t.id === mod.store.getTabsSnapshot().activeId);
    expect(active()?.emoji).toBe("🌲");
    await act(async () => {
      container.querySelector<HTMLAnchorElement>("#deeper")!.click();
    });
    await flush();
    expect(location).toBe("/a/deeper");
    expect(active()?.emoji).toBeUndefined();
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

describe("DesktopTabStrip", () => {
  async function mountStrip(opts: { leading?: boolean; enabled?: boolean; initial?: unknown } = {}) {
    await mount({ enabled: opts.enabled });
    const { DesktopTabStrip } = mod.hook;
    await act(async () => {
      root.render(
        createElement(
          createRoutesStub([
            {
              path: "*",
              Component: () =>
                createElement(DesktopTabStrip, {
                  leading: opts.leading ? createElement("button", { "data-testid": "leading" }) : undefined,
                  initial: opts.initial as never,
                }),
            },
          ]),
          { initialEntries: ["/a"] },
        ),
      );
    });
    await flush();
  }

  const strip = () => container.querySelector("nav[aria-label='Open tabs']") as HTMLElement;
  const tabButtons = () => Array.from(strip().querySelectorAll("button[aria-current], button[type='button'][style]"));

  it("is a 40px row on the nav surface with a hairline under it", async () => {
    await mountStrip();
    expect(strip().className).toContain("h-10");
    expect(strip().className).toContain("bg-os-nav");
    expect(strip().className).toContain("border-b");
  });

  it("renders the leading control before the tabs", async () => {
    await mountStrip({ leading: true });
    expect(strip().firstElementChild?.getAttribute("data-testid")).toBe("leading");
  });

  it("marks the active tab with the card plate and shows its close button", async () => {
    await mountStrip();
    const active = strip().querySelector("button[aria-current='page']") as HTMLElement;
    expect(active.className).toContain("bg-os-card");
    expect(active.className).toContain("shadow-[0_1px_1px_var(--color-os-hover)]");
    expect(active.querySelector("[aria-label^='Close']")?.className).toContain("opacity-100");
  });

  it("hides an inactive tab's close button until hover", async () => {
    await mountStrip();
    await act(async () => {
      mod.store.tabActions.open({ url: "/b", label: "B" });
    });
    await flush();
    const inactive = Array.from(strip().querySelectorAll("button")).find(
      (b) => b.textContent === "A" || b.getAttribute("aria-current") === null,
    ) as HTMLElement;
    const close = inactive.querySelector("[aria-label^='Close']") as HTMLElement;
    expect(close.className).toContain("opacity-0");
    expect(close.className).toContain("group-hover:opacity-100");
  });

  it("shows a pinned tab as an icon only, followed by a divider", async () => {
    await mountStrip();
    const id = mod.store.getTabsSnapshot().tabs[0]!.id;
    await act(async () => {
      mod.store.tabActions.togglePin(id);
    });
    await flush();
    const pinned = strip().querySelector("button[aria-current='page']") as HTMLElement;
    expect(pinned.className).toContain("w-[34px]");
    expect(pinned.textContent).toBe("");
    expect(pinned.querySelector("[aria-label^='Close']")).toBeNull();
    expect(pinned.querySelector("svg")).not.toBeNull();
    expect(strip().querySelector("span.w-px")).not.toBeNull();
  });

  it("draws no divider without pinned tabs", async () => {
    await mountStrip();
    expect(strip().querySelector("span.w-px")).toBeNull();
    expect(tabButtons().length).toBeGreaterThan(0);
  });

  it("gives every tab a glyph and keeps the new tab button", async () => {
    await mountStrip();
    expect(strip().querySelector("button[aria-current='page'] svg")).not.toBeNull();
    expect(strip().querySelector("button[aria-label='New tab']")).not.toBeNull();
  });

  it("shows a tab's emoji in place of the section glyph", async () => {
    const withEmoji = {
      tabs: [{ ...snapshot.tabs[0], emoji: "🌲" }, snapshot.tabs[1]],
      activeId: "s1",
      closed: [],
    };
    await mountStrip({ enabled: false, initial: withEmoji });
    const [first, second] = tabButtons();
    expect(first.textContent).toContain("🌲");
    expect(first.querySelector("svg.h-4")).toBeNull();
    expect(second.querySelector("svg.h-4")).not.toBeNull();
  });

  const snapshot = {
    tabs: [
      { id: "s1", url: "/x", origin: "/x", label: "Saved X", pinned: false, ephemeral: false, lastActivatedAt: 0, scrollY: 0, backStack: [], forwardStack: [] },
      { id: "s2", url: "/y", origin: "/y", label: "Saved Y", pinned: false, ephemeral: false, lastActivatedAt: 0, scrollY: 0, backStack: [], forwardStack: [] },
    ],
    activeId: "s2",
    closed: [],
  };

  it("paints the server's snapshot of the tabs before the store starts", async () => {
    await mountStrip({ enabled: false, initial: snapshot });
    expect(strip().textContent).toContain("Saved X");
    expect(strip().querySelector("button[aria-current='page']")?.textContent).toContain("Saved Y");
  });

  it("switches to the live tabs once the store has started", async () => {
    await mountStrip({ initial: snapshot });
    expect(strip().textContent).not.toContain("Saved X");
    expect(strip().querySelector("button[aria-current='page']")?.textContent).toContain("Alpha");
  });
});
