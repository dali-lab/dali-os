import { describe, it, expect } from "vitest";
import { resolveDesktopLink } from "~/lib/desktop-links";

const APP = "https://os.dali.dartmouth.edu";
const tabs = { origin: APP, base: `${APP}/documents/abc`, tabs: true };
const noTabs = { origin: APP, base: `${APP}/documents/abc`, tabs: false };

describe("resolveDesktopLink", () => {
  it("hands an off-site link to the shell, which passes it to the browser", () => {
    expect(resolveDesktopLink("https://docs.google.com/d/1", tabs)).toEqual({
      kind: "handOff",
      url: "https://docs.google.com/d/1",
    });
    // Same whether or not desktop tabs are on: an off-site page has no
    // business being a tab in the app.
    expect(resolveDesktopLink("https://docs.google.com/d/1", noTabs).kind).toBe("handOff");
  });

  it("opens an in-app link as a desktop tab while tabs are on", () => {
    expect(resolveDesktopLink("/projects/deserto", tabs)).toEqual({
      kind: "tab",
      url: `${APP}/projects/deserto`,
    });
  });

  it("navigates an in-app link when the tab strip is off", () => {
    expect(resolveDesktopLink("/projects/deserto", noTabs)).toEqual({
      kind: "navigate",
      url: `${APP}/projects/deserto`,
    });
  });

  it("resolves a relative href against the current page", () => {
    expect(resolveDesktopLink("sibling", { ...noTabs, base: `${APP}/help/calendar` })).toEqual({
      kind: "navigate",
      url: `${APP}/help/sibling`,
    });
  });

  it("hands mailto: and tel: to the OS, like an off-site link", () => {
    expect(resolveDesktopLink("mailto:dali@dartmouth.edu", tabs).kind).toBe("handOff");
    expect(resolveDesktopLink("tel:+16036461234", tabs).kind).toBe("handOff");
  });

  it("leaves the page's own schemes alone", () => {
    // Redirecting these would break them: a javascript: href is the page's own
    // code, and blob:/data: are objects only this document can resolve.
    for (const href of ["javascript:void 0", "blob:https://os.dali.dartmouth.edu/x", "data:text/plain,hi"]) {
      expect(resolveDesktopLink(href, tabs)).toEqual({ kind: "default" });
    }
  });

  it("falls through on an href it can't parse", () => {
    expect(resolveDesktopLink("http://[", tabs)).toEqual({ kind: "default" });
    // An empty href is the current page — resolves like any in-app link.
    expect(resolveDesktopLink("", tabs).kind).toBe("tab");
  });

  it("treats a different port or scheme on the same host as off-site", () => {
    // The shell only ever trusts the exact prod origin; a staging host or a
    // plain-http variant is a browser hand-off, not an in-app tab.
    expect(resolveDesktopLink("http://os.dali.dartmouth.edu/home", tabs).kind).toBe("handOff");
    expect(resolveDesktopLink("https://staging.dali.dartmouth.edu/home", tabs).kind).toBe(
      "handOff",
    );
  });
});
