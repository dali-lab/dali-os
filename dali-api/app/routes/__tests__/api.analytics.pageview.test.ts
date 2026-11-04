import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db.server", () => ({
  prisma: { pageView: { create: vi.fn(), updateMany: vi.fn() } },
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { _resetForTests as resetRateLimits } from "~/lib/rate-limit";
import { action } from "~/routes/api.analytics.pageview";

const ID = "123e4567-e89b-12d3-a456-426614174000";

function call(body: unknown, method = "POST") {
  return action({
    request: new Request("http://localhost/api/analytics/pageview", {
      method,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 DALI OS Desktop",
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1", email: "u@dali.edu", type: "member" },
    sessionId: "s1",
  } as never);
});

describe("POST /api/analytics/pageview", () => {
  it("rejects non-POST", async () => {
    expect((await call({}, "GET")).status).toBe(405);
  });

  it("returns the auth failure response", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as never);
    expect((await call({ type: "view", id: ID, path: "/help" })).status).toBe(401);
    expect(prisma.pageView.create).not.toHaveBeenCalled();
  });

  it.each([
    { type: "view", id: "not-a-uuid", path: "/help" },
    { type: "view", id: ID, path: "" },
    { type: "view", id: ID, path: "x".repeat(501) },
    { type: "duration", id: ID, durationMs: -1 },
    { type: "duration", id: ID, durationMs: 1.5 },
    { type: "other", id: ID },
  ])("400s on invalid body %j", async (body) => {
    expect((await call(body)).status).toBe(400);
  });

  it("records a view for the session user with the client class", async () => {
    const res = await call({ type: "view", id: ID, path: "/help", referrer: "/" });
    expect(res.status).toBe(204);
    expect(prisma.pageView.create).toHaveBeenCalledWith({
      data: {
        id: ID,
        userId: "u1",
        sessionId: "s1",
        path: "/help",
        referrer: "/",
        client: "desktop",
      },
    });
  });

  it("returns 204 without writing for untracked paths", async () => {
    const res = await call({ type: "view", id: ID, path: "/api/x" });
    expect(res.status).toBe(204);
    expect(prisma.pageView.create).not.toHaveBeenCalled();
  });

  it("updates duration scoped to the caller", async () => {
    const res = await call({ type: "duration", id: ID, durationMs: 5000 });
    expect(res.status).toBe(204);
    expect(prisma.pageView.updateMany).toHaveBeenCalledWith({
      where: { id: ID, userId: "u1" },
      data: { durationMs: 5000 },
    });
  });

  it("rate limits per session", async () => {
    let last = 204;
    for (let i = 0; i < 121; i++) {
      last = (await call({ type: "duration", id: ID, durationMs: 1 })).status;
    }
    expect(last).toBe(429);
  });
});
