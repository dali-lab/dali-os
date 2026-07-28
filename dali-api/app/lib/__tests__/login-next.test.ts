import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LOGIN_NEXT_COOKIE,
  clearLoginNextCookie,
  consumeLoginNext,
  isSafeLoginNext,
  pickSafeLoginNext,
  readLoginNextCookie,
  redirectToLogin,
  setLoginNextCookie,
} from "~/lib/login-next";

describe("isSafeLoginNext", () => {
  it("accepts same-origin relative paths", () => {
    expect(isSafeLoginNext("/calendar/check-in/abc")).toBe(true);
    expect(isSafeLoginNext("/documents/xyz?foo=1")).toBe(true);
    expect(isSafeLoginNext("/")).toBe(true);
  });

  it("rejects open-redirect shapes", () => {
    expect(isSafeLoginNext("//evil.com")).toBe(false);
    expect(isSafeLoginNext("https://evil.com")).toBe(false);
    expect(isSafeLoginNext("evil.com")).toBe(false);
    expect(isSafeLoginNext(null)).toBe(false);
    expect(isSafeLoginNext("")).toBe(false);
  });
});

describe("pickSafeLoginNext", () => {
  it("returns the path when safe and null otherwise", () => {
    expect(pickSafeLoginNext("/calendar/check-in/1")).toBe(
      "/calendar/check-in/1",
    );
    expect(pickSafeLoginNext("//evil.com")).toBeNull();
  });
});

describe("redirectToLogin", () => {
  it("encodes the current path+search as next", () => {
    const res = redirectToLogin(
      new Request("http://localhost/calendar/check-in/m1?x=1"),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      `/login?next=${encodeURIComponent("/calendar/check-in/m1?x=1")}`,
    );
  });
});

describe("login next cookie", () => {
  const prevEnv = process.env.DALI_APP_ENV;

  beforeEach(() => {
    process.env.DALI_APP_ENV = "dev";
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.DALI_APP_ENV;
    else process.env.DALI_APP_ENV = prevEnv;
  });

  it("setLoginNextCookie writes an encoded HttpOnly cookie", () => {
    const headers = new Headers();
    setLoginNextCookie(headers, "/calendar/check-in/m1");
    const cookie = headers.getSetCookie?.()[0] ?? headers.get("Set-Cookie")!;
    expect(cookie).toContain(
      `${LOGIN_NEXT_COOKIE}=${encodeURIComponent("/calendar/check-in/m1")}`,
    );
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/");
  });

  it("setLoginNextCookie ignores unsafe paths", () => {
    const headers = new Headers();
    setLoginNextCookie(headers, "//evil.com");
    expect(headers.get("Set-Cookie")).toBeNull();
  });

  it("readLoginNextCookie decodes a safe value", () => {
    const encoded = encodeURIComponent("/documents/abc");
    const req = new Request("http://localhost", {
      headers: { Cookie: `${LOGIN_NEXT_COOKIE}=${encoded}` },
    });
    expect(readLoginNextCookie(req)).toBe("/documents/abc");
  });

  it("readLoginNextCookie rejects an unsafe cookie value", () => {
    const encoded = encodeURIComponent("//evil.com");
    const req = new Request("http://localhost", {
      headers: { Cookie: `${LOGIN_NEXT_COOKIE}=${encoded}` },
    });
    expect(readLoginNextCookie(req)).toBeNull();
  });

  it("consumeLoginNext returns the path and clears the cookie", () => {
    const encoded = encodeURIComponent("/calendar/check-in/m1");
    const req = new Request("http://localhost", {
      headers: { Cookie: `${LOGIN_NEXT_COOKIE}=${encoded}` },
    });
    const headers = new Headers();
    expect(consumeLoginNext(req, headers)).toBe("/calendar/check-in/m1");
    const clear = headers.getSetCookie?.()[0] ?? headers.get("Set-Cookie")!;
    expect(clear).toContain(`${LOGIN_NEXT_COOKIE}=`);
    expect(clear).toContain("Max-Age=0");
  });

  it("clearLoginNextCookie expires the cookie", () => {
    const headers = new Headers();
    clearLoginNextCookie(headers);
    const cookie = headers.getSetCookie?.()[0] ?? headers.get("Set-Cookie")!;
    expect(cookie).toContain("Max-Age=0");
  });
});
