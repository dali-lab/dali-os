import { describe, it, expect } from "vitest";
import {
  generateRawCode,
  hashCode,
  generateUserCode,
  normalizeUserCode,
  formatUserCode,
  desktopPollerUserAgent,
  desktopWebviewUserAgent,
  DESKTOP_ABSOLUTE_TTL_MS,
  PAIRING_TTL_MS,
  HANDOFF_TTL_MS,
} from "~/lib/pairing";

describe("generateRawCode", () => {
  it("is a 43-char base64url string (32 random bytes)", () => {
    const code = generateRawCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is effectively unique across calls", () => {
    const a = new Set(Array.from({ length: 100 }, () => generateRawCode()));
    expect(a.size).toBe(100);
  });
});

describe("hashCode", () => {
  it("produces a 43-char base64url SHA-256 digest", () => {
    const hash = hashCode("raw");
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is deterministic and matches the session hashing scheme", () => {
    expect(hashCode("x")).toBe(hashCode("x"));
    expect(hashCode("x")).not.toBe(hashCode("y"));
  });
});

describe("generateUserCode", () => {
  it("is 8 chars from the unambiguous alphabet (no 0/O/1/I/L)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateUserCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });
});

describe("normalizeUserCode / formatUserCode", () => {
  it("normalizes case, dashes, and spaces to the canonical lookup form", () => {
    expect(normalizeUserCode("wxyz-1234")).toBe("WXYZ1234");
    expect(normalizeUserCode("wxyz 1234")).toBe("WXYZ1234");
    expect(normalizeUserCode("WXYZ1234")).toBe("WXYZ1234");
  });

  it("formats an 8-char code as XXXX-XXXX and round-trips", () => {
    const code = generateUserCode();
    expect(formatUserCode(code)).toBe(`${code.slice(0, 4)}-${code.slice(4)}`);
    expect(normalizeUserCode(formatUserCode(code))).toBe(code);
  });

  it("leaves non-8-char input ungrouped", () => {
    expect(formatUserCode("ABC")).toBe("ABC");
  });
});

describe("desktop user-agent strings", () => {
  // Must match the /DALI OS Desktop/i branch in settings.sessions.tsx so paired
  // devices are recognizable on the Your devices page.
  const re = /DALI OS Desktop/i;

  it("poller UA is recognizable and embeds the device label", () => {
    const ua = desktopPollerUserAgent({ host: "Kiran MacBook · macOS" });
    expect(ua).toMatch(re);
    expect(ua).toContain("Kiran MacBook · macOS");
    expect(ua).not.toContain("/0");
  });

  it("webview UA is recognizable and distinct from the poller UA", () => {
    const ua = desktopWebviewUserAgent({ os: "macOS" });
    expect(ua).toMatch(re);
    expect(ua).toContain("webview");
  });
});

describe("TTL constants", () => {
  it("desktop token outlives the 30-day webview session", () => {
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    expect(DESKTOP_ABSOLUTE_TTL_MS).toBeGreaterThan(THIRTY_DAYS);
  });

  it("pairing window is minutes; handoff is seconds", () => {
    expect(PAIRING_TTL_MS).toBe(10 * 60 * 1000);
    expect(HANDOFF_TTL_MS).toBe(60 * 1000);
    expect(HANDOFF_TTL_MS).toBeLessThan(PAIRING_TTL_MS);
  });
});
