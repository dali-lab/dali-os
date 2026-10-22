import { describe, expect, it } from "vitest";
import { splitVisibleOverflow, type Tab } from "~/components/TabWorkspace";

function tab(id: string, opts: Partial<Tab> = {}): Tab {
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
    ...opts,
  };
}

function unpinned(n: number): Tab[] {
  return Array.from({ length: n }, (_, i) => tab(`t${i}`, { lastActivatedAt: i }));
}

// Pixel width the strip actually lays out: tabs at 168 (pinned 128), `gap-1`
// between them, `pr-1.5` after, and the +N button (52 + `mr-1.5`) when shown.
function renderedWidth(split: ReturnType<typeof splitVisibleOverflow>): number {
  const tabs = [...split.pinned, ...split.visible];
  const tabsW = tabs.reduce((sum, t) => sum + (t.pinned ? 128 : 168), 0);
  const gaps = Math.max(0, tabs.length - 1) * 4;
  const overflowBtn = split.overflow.length > 0 ? 52 + 6 : 0;
  return tabsW + gaps + 6 + overflowBtn;
}

const ids = (tabs: Tab[]) => tabs.map((t) => t.id);

describe("splitVisibleOverflow", () => {
  it("shows every tab before the strip has been measured", () => {
    const tabs = unpinned(30);
    expect(splitVisibleOverflow(tabs, 0)).toEqual({ pinned: [], visible: tabs, overflow: [] });
  });

  it("shows everything when there are no unpinned tabs", () => {
    const tabs = [tab("p1", { pinned: true }), tab("p2", { pinned: true })];
    expect(splitVisibleOverflow(tabs, 100)).toEqual({ pinned: tabs, visible: [], overflow: [] });
  });

  it("fits three tabs exactly when gaps and right padding fit", () => {
    // 3 * 168 + 2 * 4 + 6
    const split = splitVisibleOverflow(unpinned(3), 518);
    expect(split.overflow).toEqual([]);
    expect(split.visible).toHaveLength(3);
  });

  it("overflows one pixel short of the gaps and padding", () => {
    const split = splitVisibleOverflow(unpinned(3), 517);
    expect(ids(split.visible)).toEqual(["t1", "t2"]);
    expect(ids(split.overflow)).toEqual(["t0"]);
  });

  it("budgets pinned tabs at their compact width plus a gap", () => {
    const tabs = [tab("p", { pinned: true }), ...unpinned(2)];
    // 128 + 4 + 168 + 4 + 168 + 6
    expect(splitVisibleOverflow(tabs, 478).overflow).toEqual([]);
    const tight = splitVisibleOverflow(tabs, 477);
    expect(ids(tight.pinned)).toEqual(["p"]);
    expect(tight.overflow).toHaveLength(1);
  });

  it("never pushes pinned tabs into the overflow", () => {
    const tabs = [tab("p1", { pinned: true }), tab("p2", { pinned: true }), ...unpinned(5)];
    const split = splitVisibleOverflow(tabs, 300);
    expect(ids(split.pinned)).toEqual(["p1", "p2"]);
    expect(split.overflow.every((t) => !t.pinned)).toBe(true);
  });

  it("keeps the most recently activated tabs inline, in positional order", () => {
    const tabs = [
      tab("a", { lastActivatedAt: 5 }),
      tab("b", { lastActivatedAt: 1 }),
      tab("c", { lastActivatedAt: 9 }),
      tab("d", { lastActivatedAt: 2 }),
    ];
    // Room for two tabs plus the +N button.
    const split = splitVisibleOverflow(tabs, 2 * 172 + 2 + 58);
    expect(ids(split.visible)).toEqual(["a", "c"]);
    expect(ids(split.overflow)).toEqual(["b", "d"]);
  });

  it("always keeps at least one unpinned tab visible", () => {
    const split = splitVisibleOverflow(unpinned(4), 120);
    expect(ids(split.visible)).toEqual(["t3"]);
    expect(split.overflow).toHaveLength(3);
  });

  it("never lays out wider than the strip once there is room for one tab and +N", () => {
    for (let pinnedCount = 0; pinnedCount <= 2; pinnedCount++) {
      const minWidth = pinnedCount * 132 + 168 + 6 + 58;
      for (let n = 1; n <= 12; n++) {
        const tabs = [
          ...Array.from({ length: pinnedCount }, (_, i) => tab(`p${i}`, { pinned: true })),
          ...unpinned(n),
        ];
        for (let width = minWidth; width <= 2400; width += 7) {
          const split = splitVisibleOverflow(tabs, width);
          expect(renderedWidth(split), `pinned=${pinnedCount} n=${n} width=${width}`).toBeLessThanOrEqual(width);
        }
      }
    }
  });
});
