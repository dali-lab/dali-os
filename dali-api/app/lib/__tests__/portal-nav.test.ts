import { describe, expect, it } from "vitest";
import { PORTAL_NAV, isPortalNavActive } from "~/lib/portal-nav";

function row(label: string) {
  const item = PORTAL_NAV.find((i) => i.label === label);
  if (!item) throw new Error(`no portal nav row "${label}"`);
  return item;
}

describe("isPortalNavActive", () => {
  it("lights Home only on the portal home", () => {
    expect(isPortalNavActive("/portal", row("Home"))).toBe(true);
    // Every portal path starts with /portal, so a prefix match here would
    // light Home on every page in the shell.
    expect(isPortalNavActive("/portal/education", row("Home"))).toBe(false);
    expect(isPortalNavActive("/portal/calendar", row("Home"))).toBe(false);
  });

  it("keeps a row active on its own sub-paths", () => {
    expect(isPortalNavActive("/portal/education/abc/hub", row("Education"))).toBe(true);
    expect(isPortalNavActive("/portal/calendar?view=week", row("Calendar"))).toBe(true);
  });

  it("gives the Application row the surfaces that belong to it", () => {
    for (const path of ["/portal/applications", "/portal/apply", "/portal/hiring", "/portal/application"]) {
      expect(isPortalNavActive(path, row("Application"))).toBe(true);
    }
    expect(isPortalNavActive("/portal/education", row("Application"))).toBe(false);
  });

  it("does not match a path that merely shares a prefix", () => {
    expect(isPortalNavActive("/portal/calendar-export", row("Calendar"))).toBe(false);
  });
});
