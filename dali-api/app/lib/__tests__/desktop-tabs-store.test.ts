// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type Store = typeof import("~/lib/desktop-tabs-store");

async function freshStore(): Promise<Store> {
  vi.resetModules();
  return import("~/lib/desktop-tabs-store");
}

function saved(store: Store) {
  return JSON.parse(window.localStorage.getItem(store.TABS_STORAGE_KEY) ?? "null");
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
});

describe("desktop tabs store", () => {
  it("is inactive until started and after stopping", async () => {
    const store = await freshStore();
    expect(store.tabsActive()).toBe(false);
    const stop = store.startTabs({ url: "/", label: "Home" }, vi.fn());
    expect(store.tabsActive()).toBe(true);
    stop();
    expect(store.tabsActive()).toBe(false);
  });

  it("starts a fresh window on the url it loaded, and saves it", async () => {
    const store = await freshStore();
    const navigate = vi.fn();
    store.startTabs({ url: "/projects/1", label: "Project" }, navigate);
    expect(store.getTabsSnapshot().tabs.map((t) => t.url)).toEqual(["/projects/1"]);
    expect(saved(store).tabs).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("restores saved tabs and returns to the last active one on a launch at /", async () => {
    let store = await freshStore();
    store.startTabs({ url: "/", label: "Home" }, vi.fn());
    store.tabActions.open({ url: "/projects/1", label: "Project" });
    store = await freshStore();
    const navigate = vi.fn();
    store.startTabs({ url: "/", label: "Home" }, navigate);
    expect(store.getTabsSnapshot().tabs.map((t) => t.url)).toEqual(["/", "/projects/1"]);
    expect(navigate).toHaveBeenCalledWith("/projects/1");
  });

  it("migrates the iframe workspace the first time", async () => {
    window.localStorage.setItem(
      "dali:tabworkspace:v4",
      JSON.stringify({
        panes: [{ id: "p", activeTabId: "a", tabs: [{ id: "a", url: "/calendar", label: "Calendar", lastActivatedAt: 1, backStack: [], forwardStack: [] }] }],
        focusedPaneId: "p",
        closedTabs: [],
      }),
    );
    const store = await freshStore();
    store.startTabs({ url: "/calendar", label: "Calendar" }, vi.fn());
    expect(store.getTabsSnapshot().tabs.map((t) => t.id)).toEqual(["a"]);
  });

  it("navigates to a tab it switches to and restores that tab's scroll", async () => {
    const store = await freshStore();
    const navigate = vi.fn();
    store.startTabs({ url: "/a", label: "A" }, navigate);
    store.tabActions.open({ url: "/b", label: "B" });
    expect(navigate).toHaveBeenLastCalledWith("/b", { tabSwitch: true });
    expect(store.tabActions.record("/b", "REPLACE")).toBe(0);

    window.scrollY = 640;
    const [a] = store.getTabsSnapshot().tabs;
    store.tabActions.activate(a.id);
    expect(navigate).toHaveBeenLastCalledWith("/a", { tabSwitch: true });
    expect(store.tabActions.record("/a", "REPLACE")).toBe(0);

    const b = store.getTabsSnapshot().tabs[1];
    expect(b.scrollY).toBe(640);
    store.tabActions.activate(b.id);
    expect(store.tabActions.record("/b", "REPLACE")).toBe(640);
  });

  it("restores scroll only for the switch's own landing", async () => {
    const store = await freshStore();
    store.startTabs({ url: "/a", label: "A" }, vi.fn());
    store.tabActions.open({ url: "/b", label: "B" });
    expect(store.tabActions.record("/elsewhere", "REPLACE")).toBeNull();
    expect(store.tabActions.record("/b", "PUSH")).toBeNull();
  });

  it("does not navigate when the active tab stays the same", async () => {
    const store = await freshStore();
    const navigate = vi.fn();
    store.startTabs({ url: "/a", label: "A" }, navigate);
    store.tabActions.open({ url: "/b", label: "B" }, { background: true });
    store.tabActions.activate(store.getTabsSnapshot().activeId!);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens Home when the last tab closes", async () => {
    const store = await freshStore();
    const navigate = vi.fn();
    store.startTabs({ url: "/a", label: "A" }, navigate);
    store.tabActions.closeActive();
    expect(store.getTabsSnapshot().tabs.map((t) => t.url)).toEqual(["/"]);
    expect(navigate).toHaveBeenLastCalledWith("/", { tabSwitch: true });
  });

  it("walks the active tab's history through the navigator", async () => {
    const store = await freshStore();
    const navigate = vi.fn();
    store.startTabs({ url: "/a", label: "A" }, navigate);
    store.tabActions.record("/a/1", "PUSH");
    store.tabActions.step("back");
    expect(navigate).toHaveBeenLastCalledWith("/a", { tabSwitch: true });
    store.tabActions.record("/a", "REPLACE");
    expect(store.getTabsSnapshot().tabs[0]).toMatchObject({ url: "/a", forwardStack: ["/a/1"] });
    store.tabActions.step("forward", 5);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("switches by position and cycles around the ends", async () => {
    const store = await freshStore();
    store.startTabs({ url: "/a", label: "A" }, vi.fn());
    store.tabActions.open({ url: "/b", label: "B" });
    store.tabActions.open({ url: "/c", label: "C" });
    const url = () => store.getTabsSnapshot().tabs.find((t) => t.id === store.getTabsSnapshot().activeId)?.url;
    store.tabActions.activateIndex(0);
    expect(url()).toBe("/a");
    store.tabActions.activateIndex(-1);
    expect(url()).toBe("/c");
    store.tabActions.cycle(1);
    expect(url()).toBe("/a");
    store.tabActions.cycle(-1);
    expect(url()).toBe("/c");
    store.tabActions.activateIndex(7);
    expect(url()).toBe("/c");
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    const store = await freshStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeTabs(listener);
    store.startTabs({ url: "/a", label: "A" }, vi.fn());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.tabActions.newTab();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("promotes the active preview tab", async () => {
    const store = await freshStore();
    store.startTabs({ url: "/a", label: "A" }, vi.fn());
    store.tabActions.open({ url: "/b", label: "B" }, { ephemeral: true });
    expect(store.getTabsSnapshot().tabs[1].ephemeral).toBe(true);
    store.tabActions.promoteActive();
    expect(store.getTabsSnapshot().tabs[1].ephemeral).toBe(false);
  });

  it("reopens the last closed tab", async () => {
    const store = await freshStore();
    store.startTabs({ url: "/a", label: "A" }, vi.fn());
    store.tabActions.open({ url: "/b", label: "B" });
    store.tabActions.closeActive();
    store.tabActions.reopenClosed();
    expect(store.getTabsSnapshot().tabs.map((t) => t.url)).toEqual(["/a", "/b"]);
  });
});
