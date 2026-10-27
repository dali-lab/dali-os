import { describe, expect, it } from "vitest";
import { Settings } from "lucide-react";
import { activeQuickItem, badgeLabel, orderRailAreas, splitFavorites, upcomingWhen, userMenuEntries } from "~/components/shell/rail-model";
import { homeNavItem, pinnedNavItems } from "~/lib/nav-areas";

const member = { isAlumni: false, isNewMember: false };
const pinned = pinnedNavItems(member);

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
    expect(activeQuickItem("/drive", { pinned })).toBe("/drive");
    expect(activeQuickItem("/drive/folder/abc", { pinned })).toBe("/drive");
  });

  it("lights Journeys for a new member when onboarding journeys are on", () => {
    const roles = { isAlumni: false, isNewMember: true };
    const flags = { "onboarding-journeys": true };
    const newMemberPinned = pinnedNavItems(roles, flags);
    expect(activeQuickItem("/journeys", { pinned: newMemberPinned, flags, roles })).toBe("/journeys");
  });

  it("treats Connect as Home for alumni and pins nothing", () => {
    const roles = { isAlumni: true, isNewMember: false };
    const home = homeNavItem(roles).href;
    expect(activeQuickItem("/connect", { home, pinned: pinnedNavItems(roles), roles })).toBe("home");
    expect(activeQuickItem("/", { home, pinned: pinnedNavItems(roles), roles })).toBeNull();
    expect(activeQuickItem("/drive", { home, pinned: pinnedNavItems(roles), roles })).toBeNull();
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

describe("userMenuEntries", () => {
  const urls = (o: { releaseNotes: boolean; desktopDownload: boolean }) =>
    userMenuEntries(o).map((i) => i.url);

  it("lists the base items", () => {
    expect(urls({ releaseNotes: false, desktopDownload: false })).toEqual(["/profile", "/settings", "/help"]);
  });

  it("adds What's new only with release notes", () => {
    expect(urls({ releaseNotes: true, desktopDownload: false })).toContain("/release-notes");
  });

  it("adds Get the desktop app only when asked", () => {
    expect(urls({ releaseNotes: false, desktopDownload: false })).not.toContain("/download");
    const items = userMenuEntries({ releaseNotes: false, desktopDownload: true });
    expect(items.at(-1)).toMatchObject({ url: "/download", label: "Get the desktop app" });
  });
});

describe("orderRailAreas", () => {
  const mk = (key: string) => ({ key, label: key, icon: Settings, hubPath: `/${key}`, subtabs: [] });

  it("orders Lab, Community, Core, Education, Hiring, Admin without mutating the input", () => {
    const input = ["admin", "hiring", "education", "core", "community", "projects"].map(mk);
    expect(orderRailAreas(input).map((a) => a.key)).toEqual([
      "projects",
      "community",
      "core",
      "education",
      "hiring",
      "admin",
    ]);
    expect(input[0].key).toBe("admin");
  });

  it("puts unknown areas last", () => {
    expect(orderRailAreas([mk("zzz"), mk("core")]).map((a) => a.key)).toEqual(["core", "zzz"]);
  });
});

describe("upcomingWhen", () => {
  const NY = "America/New_York";
  const now = new Date("2026-10-13T16:00:00Z"); // Tue Oct 13, noon in New York

  it("shows the time for a meeting later today", () => {
    expect(upcomingWhen("2026-10-13T18:00:00Z", now, NY)).toBe("2:00 PM");
    expect(upcomingWhen("2026-10-13T19:30:00Z", now, NY)).toBe("3:30 PM");
  });

  it("shows the weekday for a meeting on a later day", () => {
    expect(upcomingWhen("2026-10-14T14:00:00Z", now, NY)).toBe("Wed");
    expect(upcomingWhen("2026-10-19T14:00:00Z", now, NY)).toBe("Mon");
  });

  it("decides today by the viewer's zone, not UTC", () => {
    // 11:30 PM Tuesday in New York is already Wednesday in UTC.
    expect(upcomingWhen("2026-10-14T03:30:00Z", now, NY)).toBe("11:30 PM");
    expect(upcomingWhen("2026-10-14T03:30:00Z", now, "UTC")).toBe("Wed");
  });

  it("uses a plain space before AM/PM", () => {
    expect(upcomingWhen("2026-10-13T18:00:00Z", now, NY)).not.toMatch(/ /);
  });
});
