import { describe, expect, it } from "vitest";
import {
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
