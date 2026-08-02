import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRateLimit, _resetForTests } from "~/lib/rate-limit";

function makeRequest(ip = "1.2.3.4") {
  return new Request("http://localhost/test", {
    headers: { "X-Forwarded-For": ip },
  });
}

beforeEach(() => {
  _resetForTests();
});

describe("checkRateLimit", () => {
  it("allows requests under the limit", () => {
    const req = makeRequest();
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(req, { max: 3, windowMs: 60_000 })).toBeNull();
    }
  });

  it("rejects once the limit is reached", () => {
    const req = makeRequest();
    for (let i = 0; i < 5; i++) {
      checkRateLimit(req, { max: 5, windowMs: 60_000 });
    }
    const res = checkRateLimit(req, { max: 5, windowMs: 60_000 });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get("Retry-After")).toBeTruthy();
  });

  it("allows requests again after the window expires", () => {
    vi.useFakeTimers();
    const req = makeRequest();
    for (let i = 0; i < 5; i++) {
      checkRateLimit(req, { max: 5, windowMs: 60_000 });
    }
    expect(checkRateLimit(req, { max: 5, windowMs: 60_000 })).not.toBeNull();

    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit(req, { max: 5, windowMs: 60_000 })).toBeNull();
    vi.useRealTimers();
  });

  it("uses a custom key when provided", () => {
    const req = makeRequest();
    for (let i = 0; i < 2; i++) {
      checkRateLimit(req, { max: 2, windowMs: 60_000 }, "user-1");
    }
    // Same IP, different key — should be allowed
    expect(checkRateLimit(req, { max: 2, windowMs: 60_000 }, "user-2")).toBeNull();
    // Same key — should be rejected
    expect(checkRateLimit(req, { max: 2, windowMs: 60_000 }, "user-1")).not.toBeNull();
  });

  it("holds windows longer than the cleanup interval across cleanup ticks", () => {
    // Regression: cleanup used to purge anything older than 60s regardless of
    // the caller's window, collapsing e.g. 10-minute windows to ~60s.
    vi.useFakeTimers();
    const req = makeRequest();
    const opts = { max: 2, windowMs: 600_000 };
    checkRateLimit(req, opts);
    checkRateLimit(req, opts);

    // Advance past several cleanup ticks but stay within the 10-min window.
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(checkRateLimit(req, opts)).not.toBeNull();

    // Past the window, requests flow again.
    vi.advanceTimersByTime(5 * 60_000);
    expect(checkRateLimit(req, opts)).toBeNull();
    vi.useRealTimers();
  });
});
