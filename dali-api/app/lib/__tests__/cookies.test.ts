import { describe, it, expect } from "vitest";
import {
  parseSessionCookie,
  parseBearerHeader,
  parseSessionId,
  setSessionCookie,
  clearSessionCookie,
} from "~/lib/cookies";

describe("parseSessionCookie", () => {
  it("extracts __dali_sid from cookie header", () => {
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=abc123; other=xyz" },
    });
    expect(parseSessionCookie(req)).toBe("abc123");
  });

  it("returns null when cookie is missing", () => {
    const req = new Request("http://localhost");
    expect(parseSessionCookie(req)).toBeNull();
  });
});

describe("parseBearerHeader", () => {
  it("extracts the token from an Authorization: Bearer header", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer sess-id-123" },
    });
    expect(parseBearerHeader(req)).toBe("sess-id-123");
  });

  it("returns null without an Authorization header", () => {
    const req = new Request("http://localhost");
    expect(parseBearerHeader(req)).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Basic abc=" },
    });
    expect(parseBearerHeader(req)).toBeNull();
  });
});

describe("parseSessionId", () => {
  it("prefers the cookie when both cookie and header are present", () => {
    const req = new Request("http://localhost", {
      headers: {
        Cookie: "__dali_sid=cookie-id",
        Authorization: "Bearer header-id",
      },
    });
    expect(parseSessionId(req)).toBe("cookie-id");
  });

  it("falls back to the Bearer header when no cookie", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer header-id" },
    });
    expect(parseSessionId(req)).toBe("header-id");
  });

  it("returns null when neither is present", () => {
    const req = new Request("http://localhost");
    expect(parseSessionId(req)).toBeNull();
  });
});

describe("setSessionCookie", () => {
  it("appends one Set-Cookie header for __dali_sid", () => {
    const headers = new Headers();
    setSessionCookie(headers, "raw-session-id");

    const cookies = headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("__dali_sid=raw-session-id");
    expect(cookies[0]).toContain("Path=/");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("SameSite=Lax");
  });
});

describe("clearSessionCookie", () => {
  it("appends a clearing Set-Cookie header with Max-Age=0", () => {
    const headers = new Headers();
    clearSessionCookie(headers);

    const cookies = headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("__dali_sid=");
    expect(cookies[0]).toContain("Max-Age=0");
  });
});
