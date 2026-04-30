import { describe, it, expect } from "vitest";
import {
  parseAccessToken,
  parseRefreshToken,
  setTokenCookies,
  clearTokenCookies,
} from "~/lib/cookies";

describe("parseAccessToken", () => {
  it("extracts __dali_at from cookie header", () => {
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_at=abc123; __dali_rt=xyz" },
    });
    expect(parseAccessToken(req)).toBe("abc123");
  });

  it("returns null when cookie is missing", () => {
    const req = new Request("http://localhost");
    expect(parseAccessToken(req)).toBeNull();
  });
});

describe("parseRefreshToken", () => {
  it("extracts __dali_rt from cookie header", () => {
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_at=abc; __dali_rt=refresh456" },
    });
    expect(parseRefreshToken(req)).toBe("refresh456");
  });

  it("returns null when cookie is missing", () => {
    const req = new Request("http://localhost");
    expect(parseRefreshToken(req)).toBeNull();
  });
});

describe("setTokenCookies", () => {
  it("appends correct Set-Cookie headers", () => {
    const headers = new Headers();
    setTokenCookies(headers, "at_value", "rt_value");

    const cookies = headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__dali_at=at_value");
    expect(cookies[0]).toContain("Max-Age=900");
    expect(cookies[0]).toContain("Path=/");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[1]).toContain("__dali_rt=rt_value");
    expect(cookies[1]).toContain("Max-Age=604800");
    // RT cookie path is `/` so the silent refresh in `requireAuth` sees it on
    // every request — not just calls into /oauth/*.
    expect(cookies[1]).toContain("Path=/");
  });
});

describe("clearTokenCookies", () => {
  it("appends clearing Set-Cookie headers with Max-Age=0", () => {
    const headers = new Headers();
    clearTokenCookies(headers);

    const cookies = headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__dali_at=");
    expect(cookies[0]).toContain("Max-Age=0");
    expect(cookies[1]).toContain("__dali_rt=");
    expect(cookies[1]).toContain("Max-Age=0");
  });
});
