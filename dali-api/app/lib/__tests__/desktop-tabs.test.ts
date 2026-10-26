import { describe, expect, it } from "vitest";
import {
  activateTab,
  activeTab,
  arriveAt,
  closeOtherTabs,
  closeTab,
  emptyTabsState,
  labelTab,
  MAX_TABS,
  migrateWorkspaceState,
  moveTab,
  openTab,
  parseTabsState,
  promoteTab,
  recordLocation,
  reopenClosedTab,
  stepTabHistory,
  togglePin,
  type DesktopTabsState,
} from "~/lib/desktop-tabs";

let seq = 0;
function open(
  state: DesktopTabsState,
  url: string,
  opts: { ephemeral?: boolean; background?: boolean } = {},
) {
  seq += 1;
  return openTab(state, { url, label: url }, { id: `t${seq}`, now: seq, ...opts });
}

function urls(state: DesktopTabsState) {
  return state.tabs.map((t) => t.url);
}

describe("openTab", () => {
  it("opens the first tab and focuses it", () => {
    const s = open(emptyTabsState(), "/a");
    expect(urls(s)).toEqual(["/a"]);
    expect(activeTab(s)?.url).toBe("/a");
  });

  it("inserts a new tab right after the active one", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    s = activateTab(s, s.tabs[0].id, 100);
    s = open(s, "/c");
    expect(urls(s)).toEqual(["/a", "/c", "/b"]);
    expect(activeTab(s)?.url).toBe("/c");
  });

  it("focuses a tab already showing the url instead of opening another", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    s = open(s, "/a#section");
    expect(urls(s)).toEqual(["/a", "/b"]);
    expect(activeTab(s)?.url).toBe("/a");
  });

  it("reuses the one preview tab for ephemeral opens", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b", { ephemeral: true });
    s = open(s, "/c", { ephemeral: true });
    expect(urls(s)).toEqual(["/a", "/c"]);
    expect(activeTab(s)?.ephemeral).toBe(true);
  });

  it("opens in the background without moving focus", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b", { background: true });
    expect(urls(s)).toEqual(["/a", "/b"]);
    expect(activeTab(s)?.url).toBe("/a");
    expect(s.tabs[1].ephemeral).toBe(false);
  });

  it("leaves focus alone when a background open names an existing tab", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    expect(open(s, "/a", { background: true })).toBe(s);
  });

  it("evicts the least recently used unpinned tab past the cap", () => {
    let s = open(emptyTabsState(), "/0");
    s = togglePin(s, s.tabs[0].id);
    for (let i = 1; i <= MAX_TABS; i++) s = open(s, `/${i}`);
    expect(s.tabs).toHaveLength(MAX_TABS);
    expect(urls(s)).toContain("/0");
    expect(urls(s)).not.toContain("/1");
  });
});

describe("recordLocation", () => {
  it("pushes the prior url and clears forward on a page navigation", () => {
    let s = open(emptyTabsState(), "/a");
    s = recordLocation(s, "/a/1", "PUSH");
    s = recordLocation(s, "/a/2", "PUSH");
    const back = stepTabHistory(s, "back")!;
    s = recordLocation(back.state, "/a/3", "PUSH");
    expect(activeTab(s)).toMatchObject({ url: "/a/3", backStack: ["/a", "/a/1"], forwardStack: [] });
  });

  it("moves the url without history on replace and pop", () => {
    let s = open(emptyTabsState(), "/a");
    s = recordLocation(s, "/a?filter=1", "REPLACE");
    s = recordLocation(s, "/b", "POP");
    expect(activeTab(s)).toMatchObject({ url: "/b", backStack: [], forwardStack: [] });
  });

  it("promotes a preview tab once the user navigates inside it", () => {
    let s = open(emptyTabsState(), "/a", { ephemeral: true });
    s = recordLocation(s, "/a?x=1", "REPLACE");
    expect(activeTab(s)?.ephemeral).toBe(true);
    s = recordLocation(s, "/a/1", "PUSH");
    expect(activeTab(s)?.ephemeral).toBe(false);
  });

  it("only touches the active tab", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    s = recordLocation(s, "/b/1", "PUSH");
    expect(s.tabs[0]).toMatchObject({ url: "/a", backStack: [] });
  });

  it("is a no-op with no tabs or an unchanged url", () => {
    const empty = emptyTabsState();
    expect(recordLocation(empty, "/a", "PUSH")).toBe(empty);
    const s = open(empty, "/a");
    expect(recordLocation(s, "/a", "PUSH")).toBe(s);
  });
});

describe("stepTabHistory", () => {
  function walked() {
    let s = open(emptyTabsState(), "/1");
    for (const u of ["/2", "/3", "/4"]) s = recordLocation(s, u, "PUSH");
    return s;
  }

  it("steps back and forward one entry", () => {
    const back = stepTabHistory(walked(), "back")!;
    expect(back.target).toBe("/3");
    expect(activeTab(back.state)).toMatchObject({ url: "/3", backStack: ["/1", "/2"], forwardStack: ["/4"] });
    const fwd = stepTabHistory(back.state, "forward")!;
    expect(fwd.target).toBe("/4");
    expect(activeTab(fwd.state)).toMatchObject({ backStack: ["/1", "/2", "/3"], forwardStack: [] });
  });

  it("jumps several entries like repeated single steps", () => {
    const jump = stepTabHistory(walked(), "back", 3)!;
    expect(jump.target).toBe("/1");
    expect(activeTab(jump.state)).toMatchObject({ backStack: [], forwardStack: ["/4", "/3", "/2"] });
  });

  it("returns null past either end", () => {
    expect(stepTabHistory(walked(), "forward")).toBeNull();
    expect(stepTabHistory(walked(), "back", 4)).toBeNull();
    expect(stepTabHistory(emptyTabsState(), "back")).toBeNull();
  });
});

describe("closeTab", () => {
  it("focuses the right-hand neighbour when the active tab closes", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    s = open(s, "/c");
    s = activateTab(s, s.tabs[1].id, 100);
    s = closeTab(s, s.tabs[1].id);
    expect(urls(s)).toEqual(["/a", "/c"]);
    expect(activeTab(s)?.url).toBe("/c");
  });

  it("focuses the left neighbour when the last tab closes", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    s = closeTab(s, s.tabs[1].id);
    expect(activeTab(s)?.url).toBe("/a");
  });

  it("keeps focus when a background tab closes", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    s = closeTab(s, s.tabs[0].id);
    expect(activeTab(s)?.url).toBe("/b");
  });

  it("remembers closed tabs, history included, for reopening", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    s = recordLocation(s, "/b/1", "PUSH");
    s = closeTab(s, s.tabs[1].id);
    s = reopenClosedTab(s, { id: "re", now: 200 });
    expect(activeTab(s)).toMatchObject({ id: "re", url: "/b/1", origin: "/b", backStack: ["/b"] });
    expect(s.closed).toEqual([]);
  });

  it("reopening a url that is already open focuses it", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    s = closeTab(s, s.tabs[1].id);
    s = open(s, "/b");
    const before = s.tabs.length;
    s = activateTab(s, s.tabs[0].id, 300);
    s = reopenClosedTab(s, { id: "re", now: 301 });
    expect(s.tabs).toHaveLength(before);
    expect(activeTab(s)?.url).toBe("/b");
  });

  it("closes other unpinned tabs and keeps pins", () => {
    let s = open(emptyTabsState(), "/a");
    s = togglePin(s, s.tabs[0].id);
    s = open(s, "/b");
    s = open(s, "/c");
    s = closeOtherTabs(s, s.tabs.find((t) => t.url === "/c")!.id);
    expect(urls(s)).toEqual(["/a", "/c"]);
    expect(activeTab(s)?.url).toBe("/c");
  });
});

describe("pins, promotion, order, labels", () => {
  it("clusters pinned tabs on the left and promotes them", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b", { ephemeral: true });
    s = togglePin(s, s.tabs[1].id);
    expect(s.tabs[0]).toMatchObject({ url: "/b", pinned: true, ephemeral: false });
  });

  it("keeps pins first when a tab is moved past them", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    s = togglePin(s, s.tabs[0].id);
    s = moveTab(s, s.tabs[1].id, 0);
    expect(urls(s)).toEqual(["/a", "/b"]);
  });

  it("reorders unpinned tabs", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    s = open(s, "/c");
    s = moveTab(s, s.tabs[2].id, 0);
    expect(urls(s)).toEqual(["/c", "/a", "/b"]);
  });

  it("promotes a preview tab", () => {
    const s = open(emptyTabsState(), "/a", { ephemeral: true });
    expect(promoteTab(s, s.tabs[0].id).tabs[0].ephemeral).toBe(false);
  });

  it("keeps the section label on the section page and uses page titles deeper", () => {
    let s = openTab(emptyTabsState(), { url: "/hiring", label: "Cycles" }, { id: "x", now: 1 });
    expect(labelTab(s, "/hiring", "Hiring cycles")).toBe(s);
    s = recordLocation(s, "/hiring/42", "PUSH");
    s = labelTab(s, "/hiring/42", "Fall 2026");
    expect(activeTab(s)?.label).toBe("Fall 2026");
    expect(labelTab(s, "/elsewhere", "Other")).toBe(s);
  });
});

describe("arriveAt", () => {
  it("opens the first tab on a fresh window", () => {
    const { state, navigateTo } = arriveAt(emptyTabsState(), "/", "Home", { id: "h", now: 1 });
    expect(navigateTo).toBeNull();
    expect(activeTab(state)).toMatchObject({ url: "/", ephemeral: false });
  });

  it("restores the last active tab on a cold launch at /", () => {
    let s = open(emptyTabsState(), "/");
    s = open(s, "/projects/1");
    const { state, navigateTo } = arriveAt(s, "/", "Home", { id: "h", now: 1 });
    expect(state).toBe(s);
    expect(navigateTo).toBe("/projects/1");
  });

  it("stays put on a reload of the active tab", () => {
    const s = open(emptyTabsState(), "/projects/1");
    expect(arriveAt(s, "/projects/1", "Project", { id: "h", now: 1 })).toEqual({ state: s, navigateTo: null });
  });

  it("focuses or previews a deep link", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    const focused = arriveAt(s, "/a", "A", { id: "h", now: 50 }).state;
    expect(activeTab(focused)?.url).toBe("/a");
    const previewed = arriveAt(s, "/documents/9", "Doc", { id: "h", now: 50 }).state;
    expect(activeTab(previewed)).toMatchObject({ url: "/documents/9", ephemeral: true });
  });
});

describe("parsing saved state", () => {
  it("round-trips a saved set", () => {
    let s = open(emptyTabsState(), "/a");
    s = open(s, "/b");
    s = closeTab(s, s.tabs[1].id);
    expect(parseTabsState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("drops malformed tabs and repairs a dangling active id", () => {
    const s = parseTabsState({
      tabs: [{ id: "a", url: "/a", label: "A" }, { id: 3 }, null],
      activeId: "gone",
      closed: "nope",
    });
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ origin: "/a", pinned: false, backStack: [], scrollY: 0 });
    expect(s.activeId).toBe("a");
    expect(s.closed).toEqual([]);
  });

  it("returns an empty set for garbage", () => {
    expect(parseTabsState(null)).toEqual(emptyTabsState());
    expect(parseTabsState({ tabs: "x" })).toEqual(emptyTabsState());
  });

  it("migrates the iframe workspace's focused pane", () => {
    const tab = (id: string, url: string) => ({
      id,
      url,
      label: url,
      lastActivatedAt: 1,
      backStack: [],
      forwardStack: [],
    });
    const s = migrateWorkspaceState({
      panes: [
        { id: "p1", tabs: [tab("a", "/a")], activeTabId: "a" },
        { id: "p2", tabs: [tab("b", "/b"), tab("c", "/c")], activeTabId: "c" },
      ],
      focusedPaneId: "p2",
      closedTabs: [{ url: "/old", origin: "/old", label: "Old", backStack: [], forwardStack: [], closedAt: 1 }],
    });
    expect(urls(s)).toEqual(["/b", "/c"]);
    expect(s.activeId).toBe("c");
    expect(s.closed.map((c) => c.url)).toEqual(["/old"]);
  });

  it("migrates nothing from an absent workspace", () => {
    expect(migrateWorkspaceState(null)).toEqual(emptyTabsState());
  });
});
