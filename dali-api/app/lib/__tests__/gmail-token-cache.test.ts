import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "~/lib/gmail";
import { setTtlCacheEnabledForTests } from "~/lib/ttl-cache";
import { reportPerfStats } from "~/lib/perf-stats";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const isTokenCall = (url: string) => url.includes("oauth2") || url.includes("/token");
const calls = (pred: (url: string) => boolean) =>
  fetchMock.mock.calls.filter((c) => pred(String(c[0]))).length;

function respond(opts: { expiresIn?: number; sendStatus?: number } = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (isTokenCall(String(url))) {
      return { ok: true, json: async () => ({ access_token: "at", expires_in: opts.expiresIn ?? 3600 }) };
    }
    const status = opts.sendStatus ?? 200;
    return { ok: status === 200, status, text: async () => "err", json: async () => ({ id: "m" }) };
  });
}

const send = (refreshToken: string) =>
  sendEmail({ refreshToken, to: "ada@example.edu", subject: "Hi", html: "<p>x</p>" });

beforeEach(() => {
  process.env.DALI_APP_ENV = "prod";
  fetchMock.mockReset();
  setTtlCacheEnabledForTests(true);
  reportPerfStats(() => {});
});

afterEach(() => {
  setTtlCacheEnabledForTests(null);
  delete process.env.DALI_APP_ENV;
});

describe("Gmail access token cache", () => {
  it("refreshes once for two sends on the same refresh token", async () => {
    respond();
    await send("rt-a");
    await send("rt-a");
    expect(calls(isTokenCall)).toBe(1);
    expect(calls((u) => u.includes("/messages/send"))).toBe(2);
  });

  it("refreshes separately for different refresh tokens", async () => {
    respond();
    await send("rt-a");
    await send("rt-b");
    expect(calls(isTokenCall)).toBe(2);
  });

  it("drops the cached token after a 401 so the next send refreshes", async () => {
    respond({ sendStatus: 401 });
    await expect(send("rt-a")).rejects.toThrow(/Gmail send failed/);
    respond();
    await send("rt-a");
    expect(calls(isTokenCall)).toBe(2);
  });

  it("does not cache a short-lived token", async () => {
    respond({ expiresIn: 60 });
    await send("rt-a");
    await send("rt-a");
    expect(calls(isTokenCall)).toBe(2);
  });

  it("reports cache stats under a family that omits the refresh token", async () => {
    respond();
    await send("secret-refresh-token");
    const lines: string[] = [];
    reportPerfStats((l) => lines.push(l));
    expect(lines.filter((l) => l.startsWith("[cache-stats]"))).toEqual([
      expect.stringContaining("gmail:token hit=0 miss=1"),
    ]);
    expect(lines.join("\n")).not.toContain("secret-refresh-token");
  });
});
