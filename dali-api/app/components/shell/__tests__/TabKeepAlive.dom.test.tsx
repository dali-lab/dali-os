// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState, type ReactNode } from "react";
import { MAX_TABS } from "~/lib/desktop-tabs";
import { createRoot, type Root } from "react-dom/client";
import { Outlet, createRoutesStub, redirect, useLoaderData, useLocation } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Mods = {
  tabs: typeof import("~/components/DesktopTabs");
  store: typeof import("~/lib/desktop-tabs-store");
  keep: typeof import("~/components/shell/TabKeepAlive");
  bar: typeof import("~/components/shell/page-bar-slot");
};

let container: HTMLDivElement;
let root: Root;
let m: Mods;
let gates: Record<string, Promise<void>> = {};
let loads: Record<string, number> = {};

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

async function mount(opts: { enabled?: boolean } = {}) {
  vi.resetModules();
  m = {
    tabs: await import("~/components/DesktopTabs"),
    store: await import("~/lib/desktop-tabs-store"),
    keep: await import("~/components/shell/TabKeepAlive"),
    bar: await import("~/components/shell/page-bar-slot"),
  };
  (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };

  function Page() {
    const [count, setCount] = useState(0);
    const loc = useLocation();
    const data = useLoaderData() as { path: string; n: number };
    return createElement(
      "section",
      { "data-page": data.path },
      createElement("button", { "data-inc": data.path, onClick: () => setCount((c) => c + 1) }, "inc"),
      createElement("span", { "data-count": data.path }, String(count)),
      createElement("span", { "data-loc": data.path }, loc.pathname),
      createElement("span", { "data-load": data.path }, String(data.n)),
      createElement(m.bar.PageBarPortal, {
        slot: "actions",
        children: createElement("i", { "data-bar": data.path }),
      }),
      createElement(m.bar.PageBarMenuItems, { children: createElement("b", { "data-menu": data.path }) }),
    );
  }

  function Bar() {
    const { actionsRef } = m.bar.usePageBarTargetSetters();
    const items = m.bar.usePageBarMenuItems();
    return createElement("div", { id: "bar", ref: actionsRef, "data-menu-count": items.length });
  }

  function Shell() {
    const show = m.tabs.useDesktopTabs(opts.enabled !== false, false);
    return createElement(
      m.bar.PageBarSlotProvider,
      null,
      createElement(Bar),
      createElement(
        m.keep.TabsShowingProvider,
        { value: show },
        createElement(m.keep.TabKeepAlive, null, createElement(Outlet) as ReactNode),
      ),
    );
  }

  const paths = ["/a", "/b", ...Array.from({ length: 20 }, (_, i) => `/t${i + 1}`)];
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: Shell,
      children: [
        ...paths.map((path) => ({
          path,
          Component: () => createElement(Page),
          loader: async () => {
            loads[path] = (loads[path] ?? 0) + 1;
            await gates[path];
            return { path, n: loads[path] };
          },
        })),
        { path: "/moved", loader: () => redirect("/b") },
      ],
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/a"] }));
  });
  await flush();
}

const page = (p: string) => container.querySelector(`[data-page="${p}"]`) as HTMLElement | null;
const visible = (p: string) => {
  const el = page(p);
  return !!el && !el.closest("[hidden]") && getComputedStyle(el.parentElement!).display !== "none" && !hiddenAncestor(el);
};
function hiddenAncestor(el: Element): boolean {
  for (let n: Element | null = el; n && n !== container; n = n.parentElement) {
    if ((n as HTMLElement).style?.display === "none") return true;
  }
  return false;
}
const text = (kind: string, p: string) => container.querySelector(`[data-${kind}="${p}"]`)?.textContent;
const click = async (p: string) => {
  await act(async () => {
    (container.querySelector(`[data-inc="${p}"]`) as HTMLButtonElement).click();
  });
};
const bars = () => [...container.querySelectorAll("#bar [data-bar]")].map((e) => e.getAttribute("data-bar"));
const open = async (url: string) => {
  await act(async () => {
    m.store.tabActions.open({ url, label: url });
  });
  await flush();
};

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "dali_tabstrip=; Max-Age=0; Path=/";
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  gates = {};
  loads = {};
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP;
});

describe("TabKeepAlive", () => {
  it("keeps a tab's component state across a switch away and back", async () => {
    await mount();
    await click("/a");
    await click("/a");
    await open("/b");
    expect(visible("/b")).toBe(true);
    expect(visible("/a")).toBe(false);
    const [a] = m.store.getTabsSnapshot().tabs;
    await act(async () => m.store.tabActions.activate(a.id));
    await flush();
    expect(visible("/a")).toBe(true);
    expect(text("count", "/a")).toBe("2");
  });

  it("leaves the previous tab's page alone when the new tab's url redirects", async () => {
    await mount();
    await click("/a");
    await click("/a");
    await open("/moved");
    expect(visible("/b")).toBe(true);
    expect(text("count", "/a")).toBe("2");
    expect(text("loc", "/a")).toBe("/a");
    const [a, b] = m.store.getTabsSnapshot().tabs;
    await act(async () => m.store.tabActions.activate(a.id));
    await flush();
    expect(visible("/a")).toBe(true);
    expect(text("count", "/a")).toBe("2");
    await click("/b");
    await act(async () => m.store.tabActions.activate(b.id));
    await flush();
    expect(visible("/b")).toBe(true);
    expect(text("count", "/b")).toBe("1");
  });

  it("gives each hidden page its own location, not the active page's", async () => {
    await mount();
    await open("/b");
    expect(text("loc", "/a")).toBe("/a");
    expect(text("loc", "/b")).toBe("/b");
  });

  it("shows the target tab at once and refreshes its loader data when the router arrives", async () => {
    await mount();
    await click("/a");
    await open("/b");
    const [a] = m.store.getTabsSnapshot().tabs;
    let release!: () => void;
    gates["/a"] = new Promise<void>((r) => (release = r));
    await act(async () => m.store.tabActions.activate(a.id));
    expect(visible("/a")).toBe(true);
    expect(visible("/b")).toBe(false);
    expect(text("load", "/a")).toBe("1");
    await act(async () => release());
    await flush();
    expect(text("load", "/a")).toBe("2");
    expect(text("count", "/a")).toBe("1");
  });

  it("keeps every open tab's page, and drops a page when its tab closes or ages out", async () => {
    await mount();
    for (let i = 1; i < MAX_TABS; i++) await open(`/t${i}`);
    expect(m.store.getTabsSnapshot().tabs).toHaveLength(MAX_TABS);
    expect(container.querySelectorAll("[data-page]").length).toBe(MAX_TABS);
    await open(`/t${MAX_TABS}`);
    expect(m.store.getTabsSnapshot().tabs.some((t) => t.url === "/a")).toBe(false);
    expect(page("/a")).toBeNull();
    expect(container.querySelectorAll("[data-page]").length).toBe(MAX_TABS);
    const t2 = m.store.getTabsSnapshot().tabs.find((t) => t.url === "/t2")!;
    await act(async () => m.store.tabActions.close(t2.id));
    await flush();
    expect(page("/t2")).toBeNull();
  });

  it("lets only the displayed page contribute to the page bar", async () => {
    await mount();
    await open("/b");
    expect(bars()).toEqual(["/b"]);
    expect(container.querySelector("#bar")?.getAttribute("data-menu-count")).toBe("1");
    const [a] = m.store.getTabsSnapshot().tabs;
    await act(async () => m.store.tabActions.activate(a.id));
    await flush();
    expect(bars()).toEqual(["/a"]);
  });

  it("keeps nothing when tabs are off", async () => {
    await mount({ enabled: false });
    await act(async () => {
      m.store.tabActions.open({ url: "/b", label: "b" });
    });
    await flush();
    expect(container.querySelectorAll("[data-page]").length).toBe(1);
  });
});
