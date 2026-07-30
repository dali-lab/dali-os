import { describe, expect, it } from "vitest";
import {
  closeTabInState,
  type Pane,
  type Tab,
  type WorkspaceState,
} from "~/components/TabWorkspace";

function tab(id: string, url = `/${id}`): Tab {
  return {
    id,
    label: id,
    url,
    origin: url,
    lastActivatedAt: 0,
    backStack: [],
    forwardStack: [],
    pinned: false,
    ephemeral: false,
  };
}

function pane(id: string, tabs: Tab[], activeTabId = tabs[0]?.id ?? null): Pane {
  return { id, tabs, activeTabId };
}

function state(panes: Pane[], focusedPaneId = panes[0].id): WorkspaceState {
  return { panes, focusedPaneId, closedTabs: [] };
}

describe("closeTabInState", () => {
  it("removes the tab and records it as reopenable", () => {
    const next = closeTabInState(
      state([pane("p1", [tab("a"), tab("b")])]),
      "p1",
      "a",
    );
    expect(next.panes[0].tabs.map((t) => t.id)).toEqual(["b"]);
    expect(next.closedTabs.map((t) => t.url)).toEqual(["/a"]);
  });

  it("repoints activeTabId to the neighbour when the active tab closes", () => {
    const next = closeTabInState(
      state([pane("p1", [tab("a"), tab("b"), tab("c")], "b")]),
      "p1",
      "b",
    );
    expect(next.panes[0].activeTabId).toBe("c");
  });

  it("leaves activeTabId alone when a background tab closes", () => {
    const next = closeTabInState(
      state([pane("p1", [tab("a"), tab("b")], "a")]),
      "p1",
      "b",
    );
    expect(next.panes[0].activeTabId).toBe("a");
  });

  // The case this whole change exists for: a document opened to the side is the
  // only tab in the second pane, so closing it has to collapse the split rather
  // than leave an empty pane behind.
  it("drops a pane that empties and refocuses a survivor", () => {
    const next = closeTabInState(
      state([pane("p1", [tab("project")]), pane("p2", [tab("doc")])], "p2"),
      "p2",
      "doc",
    );
    expect(next.panes.map((p) => p.id)).toEqual(["p1"]);
    expect(next.focusedPaneId).toBe("p1");
  });

  it("keeps the last pane even when it empties", () => {
    const next = closeTabInState(state([pane("p1", [tab("a")])]), "p1", "a");
    expect(next.panes).toHaveLength(1);
    expect(next.panes[0].tabs).toEqual([]);
    expect(next.panes[0].activeTabId).toBeNull();
  });

  it("is a no-op for a tab id that isn't in the pane", () => {
    const before = state([pane("p1", [tab("a")])]);
    const next = closeTabInState(before, "p1", "missing");
    expect(next.panes[0].tabs.map((t) => t.id)).toEqual(["a"]);
    expect(next.closedTabs).toEqual([]);
  });
});
