import { describe, it, expect } from "vitest";
import { isFocusRequest, FOCUS_COOKIE } from "~/lib/focus-mode";

function req(cookie?: string): Request {
  return new Request("https://dali.test/", {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe("isFocusRequest", () => {
  it("is false when no Cookie header", () => {
    expect(isFocusRequest(req())).toBe(false);
  });

  it("is false when the focus cookie is absent", () => {
    expect(isFocusRequest(req("__dali_sid=abc; dali_tabless=1"))).toBe(false);
  });

  it("is true when the focus cookie is set to 1", () => {
    expect(isFocusRequest(req(`${FOCUS_COOKIE}=1`))).toBe(true);
  });

  it("finds the cookie among others", () => {
    expect(isFocusRequest(req(`__dali_sid=abc; ${FOCUS_COOKIE}=1; theme=dark`))).toBe(true);
  });

  it("is false for any value other than 1 (e.g. a cleared cookie)", () => {
    expect(isFocusRequest(req(`${FOCUS_COOKIE}=`))).toBe(false);
    expect(isFocusRequest(req(`${FOCUS_COOKIE}=0`))).toBe(false);
  });
});
