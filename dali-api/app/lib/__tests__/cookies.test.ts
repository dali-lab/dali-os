import { describe, it, expect } from "vitest";
import { parseBearerHeader, clearSessionCookie } from "~/lib/cookies";

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

  it("ignores a legacy __dali_sid cookie", () => {
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=abc123" },
    });
    expect(parseBearerHeader(req)).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Basic abc=" },
    });
    expect(parseBearerHeader(req)).toBeNull();
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
