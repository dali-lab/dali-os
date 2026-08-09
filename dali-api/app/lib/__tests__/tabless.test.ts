import { describe, it, expect } from "vitest";
import {
  isTablessRequest,
  hasExplicitTablessPreference,
  tablessCookieHeader,
  TABLESS_COOKIE,
} from "~/lib/tabless";

function req(cookie?: string): Request {
  return new Request("https://dali.test/", {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe("isTablessRequest", () => {
  it("defaults to tabless with no Cookie header", () => {
    expect(isTablessRequest(req())).toBe(true);
  });

  it("defaults to tabless when the cookie is absent", () => {
    expect(isTablessRequest(req("__dali_sid=abc; foo=bar"))).toBe(true);
  });

  it("is true when the cookie is set to 1", () => {
    expect(isTablessRequest(req(`${TABLESS_COOKIE}=1`))).toBe(true);
  });

  it("finds the cookie among others", () => {
    expect(
      isTablessRequest(req(`__dali_sid=abc; ${TABLESS_COOKIE}=0; theme=dark`)),
    ).toBe(false);
  });

  it("is false only for the explicit tabbed opt-in (0)", () => {
    expect(isTablessRequest(req(`${TABLESS_COOKIE}=0`))).toBe(false);
    expect(isTablessRequest(req(`${TABLESS_COOKIE}=`))).toBe(true);
  });
});

describe("hasExplicitTablessPreference", () => {
  it("is false with no Cookie header", () => {
    expect(hasExplicitTablessPreference(req())).toBe(false);
  });

  it("is false when the cookie is absent among others", () => {
    expect(hasExplicitTablessPreference(req("__dali_sid=abc; foo=bar"))).toBe(false);
  });

  it("is true once the cookie has been set, regardless of value", () => {
    expect(hasExplicitTablessPreference(req(`${TABLESS_COOKIE}=1`))).toBe(true);
    expect(hasExplicitTablessPreference(req(`${TABLESS_COOKIE}=0`))).toBe(true);
    expect(
      hasExplicitTablessPreference(req(`__dali_sid=abc; ${TABLESS_COOKIE}=0; theme=dark`)),
    ).toBe(true);
  });
});

describe("tablessCookieHeader", () => {
  it("round-trips through isTablessRequest", () => {
    expect(isTablessRequest(req(tablessCookieHeader(true)))).toBe(true);
    expect(isTablessRequest(req(tablessCookieHeader(false)))).toBe(false);
  });
});
