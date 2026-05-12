import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function loadHeaders(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return await import("~/lib/security-headers");
}

describe("securityHeaders / contentSecurityPolicy", () => {
  it("emits a Content-Security-Policy-Report-Only header in non-production", async () => {
    const { securityHeaders } = await loadHeaders({ NODE_ENV: "test" });
    const h = securityHeaders();
    expect(h["Content-Security-Policy-Report-Only"]).toBeTruthy();
    expect(h["Content-Security-Policy"]).toBeUndefined();
  });

  it("includes the expected core directives", async () => {
    const { contentSecurityPolicy } = await loadHeaders({ NODE_ENV: "test" });
    const csp = contentSecurityPolicy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com data:");
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it("preserves single-quoted CSP keywords like 'self' and 'none'", async () => {
    const { contentSecurityPolicy } = await loadHeaders({ NODE_ENV: "test" });
    const csp = contentSecurityPolicy();
    expect(csp).toMatch(/'self'/);
    expect(csp).toMatch(/'none'/);
  });

  it("permits ws:/wss: in connect-src outside production", async () => {
    const { contentSecurityPolicy } = await loadHeaders({ NODE_ENV: "development" });
    expect(contentSecurityPolicy()).toContain("connect-src 'self' ws: wss:");
  });

  it("uses Report-Only in production when CSP_ENFORCE is unset", async () => {
    const { securityHeaders } = await loadHeaders({
      NODE_ENV: "production",
      CSP_ENFORCE: undefined,
      COLLAB_URL: undefined,
    });
    const h = securityHeaders();
    expect(h["Content-Security-Policy-Report-Only"]).toBeTruthy();
    expect(h["Content-Security-Policy"]).toBeUndefined();
  });

  it("flips to enforcing mode when CSP_ENFORCE=1 in production", async () => {
    const { securityHeaders } = await loadHeaders({
      NODE_ENV: "production",
      CSP_ENFORCE: "1",
    });
    const h = securityHeaders();
    expect(h["Content-Security-Policy"]).toBeTruthy();
    expect(h["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("includes upgrade-insecure-requests in production", async () => {
    const { contentSecurityPolicy } = await loadHeaders({ NODE_ENV: "production" });
    expect(contentSecurityPolicy()).toContain("upgrade-insecure-requests");
  });

  it("narrows connect-src in production to the COLLAB_URL origin", async () => {
    const { contentSecurityPolicy } = await loadHeaders({
      NODE_ENV: "production",
      COLLAB_URL: "wss://collab.example.com:443/path",
    });
    const csp = contentSecurityPolicy();
    expect(csp).toContain("connect-src 'self' wss://collab.example.com");
    expect(csp).not.toMatch(/connect-src[^;]* ws:/);
    expect(csp).not.toMatch(/connect-src[^;]* wss: /);
  });

  it("falls back to 'self' only in production when COLLAB_URL is unset", async () => {
    const { contentSecurityPolicy } = await loadHeaders({
      NODE_ENV: "production",
      COLLAB_URL: undefined,
    });
    const csp = contentSecurityPolicy();
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/connect-src[^;]* ws:/);
    expect(csp).not.toMatch(/connect-src[^;]* wss:/);
  });

  it("keeps the existing non-CSP security headers", async () => {
    const { securityHeaders } = await loadHeaders({ NODE_ENV: "test" });
    const h = securityHeaders();
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("camera=()");
  });
});
