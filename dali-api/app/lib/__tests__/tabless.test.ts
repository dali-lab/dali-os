import { describe, it, expect } from "vitest";
import { isTablessRequest, TABLESS_COOKIE } from "~/lib/tabless";

function req(cookie?: string): Request {
  return new Request("https://dali.test/", {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe("isTablessRequest", () => {
  it("is false when no Cookie header", () => {
    expect(isTablessRequest(req())).toBe(false);
  });

  it("is false when the tabless cookie is absent", () => {
    expect(isTablessRequest(req("__dali_sid=abc; foo=bar"))).toBe(false);
  });

  it("is true when the tabless cookie is set to 1", () => {
    expect(isTablessRequest(req(`${TABLESS_COOKIE}=1`))).toBe(true);
  });

  it("finds the cookie among others", () => {
    expect(
      isTablessRequest(req(`__dali_sid=abc; ${TABLESS_COOKIE}=1; theme=dark`)),
    ).toBe(true);
  });

  it("is false for any value other than 1 (e.g. a cleared cookie)", () => {
    expect(isTablessRequest(req(`${TABLESS_COOKIE}=`))).toBe(false);
    expect(isTablessRequest(req(`${TABLESS_COOKIE}=0`))).toBe(false);
  });
});
