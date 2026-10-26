import { describe, expect, it } from "vitest";
import {
  encodeTabsSnapshot,
  parseTabsSnapshot,
  tabsSnapshotFromRequest,
  parseTabStripCookie,
  tabStripCookieHeader,
  tabStripHintFromRequest,
  tabsPreferred,
} from "~/lib/desktop-tabs-pref";

const req = (cookie?: string) =>
  new Request("http://x/", { headers: cookie ? { Cookie: cookie } : {} });

describe("tab strip cookie", () => {
  it("reads 1, 0, and nothing else", () => {
    expect(parseTabStripCookie("a=b; dali_tabstrip=1")).toBe("1");
    expect(parseTabStripCookie("dali_tabstrip=0")).toBe("0");
    expect(parseTabStripCookie("dali_tabstrip=yes")).toBeNull();
    expect(parseTabStripCookie("dali_tabless=1")).toBeNull();
    expect(parseTabStripCookie("")).toBeNull();
  });

  it("reserves the strip on the server only when the app last showed it", () => {
    expect(tabStripHintFromRequest(req("dali_tabstrip=1"))).toBe(true);
    expect(tabStripHintFromRequest(req("dali_tabstrip=0"))).toBe(false);
    expect(tabStripHintFromRequest(req())).toBe(false);
  });

  it("defaults tabs on until the user turns them off", () => {
    expect(tabsPreferred(null)).toBe(true);
    expect(tabsPreferred("1")).toBe(true);
    expect(tabsPreferred("0")).toBe(false);
  });

  it("writes a year-long, site-wide cookie", () => {
    expect(tabStripCookieHeader("0")).toBe("dali_tabstrip=0; Max-Age=31536000; Path=/; SameSite=Lax");
  });
});

const tab = (id: string, over: Partial<Record<string, unknown>> = {}) => ({
  id,
  url: `/p/${id}`,
  origin: `/p/${id}`,
  label: `Tab ${id}`,
  pinned: false,
  ephemeral: false,
  lastActivatedAt: 5,
  scrollY: 40,
  backStack: ["/old"],
  forwardStack: [],
  ...over,
});

const cookieFor = (state: Parameters<typeof encodeTabsSnapshot>[0]) => `dali_tabs=${encodeTabsSnapshot(state)}`;

describe("tabs snapshot cookie", () => {
  it("round-trips what the strip draws: id, url, label, pinned, preview, active", () => {
    const state = {
      tabs: [tab("a", { pinned: true }), tab("b", { ephemeral: true }), tab("c")],
      activeId: "b",
      closed: [],
    };
    const parsed = parseTabsSnapshot(`other=1; ${cookieFor(state)}`)!;
    expect(parsed.activeId).toBe("b");
    expect(parsed.tabs.map((t) => [t.id, t.url, t.label, t.pinned, t.ephemeral])).toEqual([
      ["a", "/p/a", "Tab a", true, false],
      ["b", "/p/b", "Tab b", false, true],
      ["c", "/p/c", "Tab c", false, false],
    ]);
    expect(parsed.tabs[0]!.backStack).toEqual([]);
  });

  it("keeps a tab's emoji, and reads rows written before tabs had one", () => {
    const state = { tabs: [tab("a", { emoji: "🌲" }), tab("b")], activeId: "a", closed: [] };
    const parsed = parseTabsSnapshot(cookieFor(state))!;
    expect(parsed.tabs[0]!.emoji).toBe("🌲");
    expect(parsed.tabs[1]).not.toHaveProperty("emoji");
    const old = encodeURIComponent(JSON.stringify({ a: "a", t: [["a", "/p/a", "Tab a", 0]] }));
    expect(parseTabsSnapshot(`dali_tabs=${old}`)!.tabs[0]).not.toHaveProperty("emoji");
  });

  it("stays under the cookie budget by dropping tabs from the end", () => {
    const tabs = Array.from({ length: 20 }, (_, i) => tab(`t${i}`, { url: `/documents/${"x".repeat(250)}${i}`, label: "L".repeat(80) }));
    const encoded = encodeTabsSnapshot({ tabs, activeId: "t0", closed: [] });
    expect(encoded.length).toBeLessThanOrEqual(3000);
    const parsed = parseTabsSnapshot(`dali_tabs=${encoded}`)!;
    expect(parsed.tabs[0]!.id).toBe("t0");
    expect(parsed.tabs.length).toBeLessThan(20);
    expect(parsed.tabs[0]!.label.length).toBe(40);
  });

  it("leaves out tabs with very long urls", () => {
    const parsed = parseTabsSnapshot(
      cookieFor({ tabs: [tab("a", { url: "/" + "q".repeat(400) }), tab("b")], activeId: "a", closed: [] }),
    )!;
    expect(parsed.tabs.map((t) => t.id)).toEqual(["b"]);
    expect(parsed.activeId).toBeNull();
  });

  it("ignores a missing or garbled cookie", () => {
    expect(parseTabsSnapshot("")).toBeNull();
    expect(parseTabsSnapshot("dali_tabs=%7Bnope")).toBeNull();
    expect(parseTabsSnapshot(`dali_tabs=${encodeURIComponent(JSON.stringify({ a: "x", t: [[1, 2]] }))}`)).toEqual({
      tabs: [],
      activeId: null,
      closed: [],
    });
  });

  it("reads the snapshot off a request", () => {
    expect(tabsSnapshotFromRequest(req(cookieFor({ tabs: [tab("a")], activeId: "a", closed: [] })))?.activeId).toBe("a");
    expect(tabsSnapshotFromRequest(req())).toBeNull();
  });
});
