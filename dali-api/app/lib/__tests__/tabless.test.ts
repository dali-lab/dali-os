import { describe, it, expect } from "vitest";
import { isTablessRequest, TABLESS_COOKIE } from "~/lib/tabless";

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
