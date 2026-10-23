import { describe, it, expect, beforeEach, vi } from "vitest";

const updateMany = vi.hoisted(() => vi.fn());
vi.mock("~/lib/db", () => ({ prisma: { devicePairing: { updateMany } } }));
const requireMobileUser = vi.fn();
vi.mock("~/lib/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mobile-auth.server")>()),
  requireMobileUser: (...a: unknown[]) => requireMobileUser(...a),
}));
vi.mock("~/lib/app-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/app-env")>()),
  getApiBaseUrl: () => "https://os.example",
}));

import { hashCode, HANDOFF_TTL_MS } from "~/lib/pairing";
import { action } from "../api.mobile.webview";

const post = (body: unknown, method = "POST") =>
  new Request("https://os.example/api/mobile/webview", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T15:00:00.000Z"));
  requireMobileUser.mockResolvedValue({ ok: true, userId: "u1", auth: { sessionId: "hashed-session" } });
  updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/mobile/webview", () => {
  it("mints a single-use handoff on this app session's pairing and links to the page editor", async () => {
    const res = (await action({ request: post({ pageId: "pg1" }) } as never)) as Response;
    const { url } = await res.json();
    const link = new URL(url);

    expect(link.origin + link.pathname).toBe("https://os.example/auth/handoff");
    expect(link.searchParams.get("next")).toBe("/documents/pg1?embed=1");
    const code = link.searchParams.get("code")!;
    expect(updateMany).toHaveBeenCalledWith({
      where: { desktopSessionId: "hashed-session", userId: "u1", status: "Consumed" },
      data: {
        handoffCodeHash: hashCode(code),
        handoffExpiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
        handoffUsedAt: null,
      },
    });
  });

  it("mints a different code each time", async () => {
    const first = new URL((await ((await action({ request: post({ pageId: "pg1" }) } as never)) as Response).json()).url);
    const second = new URL((await ((await action({ request: post({ pageId: "pg1" }) } as never)) as Response).json()).url);
    expect(first.searchParams.get("code")).not.toBe(second.searchParams.get("code"));
  });

  it("asks the member to sign in again when the session has no pairing to mint on", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const res = (await action({ request: post({ pageId: "pg1" }) } as never)) as Response;
    expect(res.status).toBe(409);
  });

  it("escapes the page id into the path", async () => {
    const res = (await action({ request: post({ pageId: "a/../b" }) } as never)) as Response;
    expect(new URL((await res.json()).url).searchParams.get("next")).toBe("/documents/a%2F..%2Fb?embed=1");
  });

  it("requires a page id", async () => {
    const res = (await action({ request: post({}) } as never)) as Response;
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns the guard's response for a member it doesn't let in", async () => {
    const response = new Response(null, { status: 404 });
    requireMobileUser.mockResolvedValue({ ok: false, response });
    expect(await action({ request: post({ pageId: "pg1" }) } as never)).toBe(response);
  });

  it("only accepts POST", async () => {
    const res = (await action({ request: post({ pageId: "pg1" }, "PUT") } as never)) as Response;
    expect(res.status).toBe(405);
  });
});
