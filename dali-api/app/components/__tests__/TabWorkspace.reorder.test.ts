import { describe, expect, it } from "vitest";
import { resolveTabDrop, type Pane, type Tab } from "~/components/TabWorkspace";

function tab(id: string): Tab {
  return {
    id,
    label: id,
    url: `/${id}`,
    origin: `/${id}`,
    lastActivatedAt: 0,
    backStack: [],
    forwardStack: [],
    pinned: false,
    ephemeral: false,
  };
}

function pane(id: string, ids: string[]): Pane {
  const tabs = ids.map(tab);
  return { id, tabs, activeTabId: tabs[0]?.id ?? null };
}

// resolveTabDrop maps a "dropped tab onto another tab" gesture to an insertion
// index in the target pane's tabs[] that moveTab then applies. Same-pane it must
// reproduce @dnd-kit's arrayMove; cross-pane it inserts before the over tab.
describe("resolveTabDrop", () => {
  it("same pane, dragging rightwards lands after the over tab (arrayMove)", () => {
    // [a,b,c,d], drag a over c -> insert after c === [b,c,a,d]
    const panes = [pane("p1", ["a", "b", "c", "d"])];
    expect(
      resolveTabDrop({ paneId: "p1", tabId: "a" }, { paneId: "p1", tabId: "c" }, panes),
    ).toEqual({ paneId: "p1", index: 3 });
  });

  it("same pane, dragging leftwards lands before the over tab (arrayMove)", () => {
    // [a,b,c,d], drag d over b -> insert before b === [a,d,b,c]
    const panes = [pane("p1", ["a", "b", "c", "d"])];
    expect(
      resolveTabDrop({ paneId: "p1", tabId: "d" }, { paneId: "p1", tabId: "b" }, panes),
    ).toEqual({ paneId: "p1", index: 1 });
  });

  it("dropping a tab on itself yields its own index (moveTab no-ops it)", () => {
    const panes = [pane("p1", ["a", "b", "c"])];
    expect(
      resolveTabDrop({ paneId: "p1", tabId: "b" }, { paneId: "p1", tabId: "b" }, panes),
    ).toEqual({ paneId: "p1", index: 1 });
  });

  it("cross pane inserts before the over tab in the target pane", () => {
    const panes = [pane("p1", ["a", "b"]), pane("p2", ["x", "y", "z"])];
    expect(
      resolveTabDrop({ paneId: "p1", tabId: "a" }, { paneId: "p2", tabId: "z" }, panes),
    ).toEqual({ paneId: "p2", index: 2 });
  });

  it("returns null when the target pane or over tab is gone", () => {
    const panes = [pane("p1", ["a", "b"])];
    expect(
      resolveTabDrop({ paneId: "p1", tabId: "a" }, { paneId: "nope", tabId: "b" }, panes),
    ).toBeNull();
    expect(
      resolveTabDrop({ paneId: "p1", tabId: "a" }, { paneId: "p1", tabId: "gone" }, panes),
    ).toBeNull();
  });
});
