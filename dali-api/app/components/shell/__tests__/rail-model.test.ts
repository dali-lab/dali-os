import { describe, expect, it } from "vitest";
import { activeQuickItem, badgeLabel, splitFavorites } from "~/components/shell/rail-model";

describe("activeQuickItem", () => {
  it("lights Home only on exactly /", () => {
    expect(activeQuickItem("/")).toBe("home");
    expect(activeQuickItem("/?x=1")).toBe("home");
    expect(activeQuickItem("/projects")).toBeNull();
  });

  it("matches Calendar and Email by prefix", () => {
    expect(activeQuickItem("/calendar")).toBe("calendar");
    expect(activeQuickItem("/calendar/check-in/abc")).toBe("calendar");
    expect(activeQuickItem("/email?folder=sent")).toBe("email");
  });

  it("lights Drive on its subtree", () => {
    expect(activeQuickItem("/drive")).toBe("/drive");
    expect(activeQuickItem("/drive/folder/abc")).toBe("/drive");
  });

  it("matches nothing on a plain area page", () => {
    expect(activeQuickItem("/core/staffing")).toBeNull();
  });
});

describe("splitFavorites", () => {
  const ids = ["a", "b", "c", "d", "e"];

  it("shows the first three and counts the rest", () => {
    expect(splitFavorites(ids, false)).toEqual({ visible: ["a", "b", "c"], hiddenCount: 2, canToggle: true });
  });

  it("shows everything when expanded", () => {
    expect(splitFavorites(ids, true)).toEqual({ visible: ids, hiddenCount: 0, canToggle: true });
  });

  it("offers no toggle at or under the limit", () => {
    expect(splitFavorites(["a", "b", "c"], false)).toEqual({ visible: ["a", "b", "c"], hiddenCount: 0, canToggle: false });
    expect(splitFavorites([], false)).toEqual({ visible: [], hiddenCount: 0, canToggle: false });
  });

  it("honours a custom limit", () => {
    expect(splitFavorites(ids, false, 1).visible).toEqual(["a"]);
  });
});

describe("badgeLabel", () => {
  it("caps at 99+", () => {
    expect(badgeLabel(7)).toBe("7");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
  });
});
