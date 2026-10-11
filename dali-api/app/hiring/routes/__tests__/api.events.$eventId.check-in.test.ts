import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/hiring/lib/hiring-events.server", () => ({ selfCheckInToEvent: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { selfCheckInToEvent } from "~/hiring/lib/hiring-events.server";
import { action } from "~/hiring/routes/api.events.$eventId.check-in";

const EVENT_ID = "evt-1";

function post(body?: unknown): Request {
  return new Request(`http://localhost/api/hiring/events/${EVENT_ID}/check-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const run = (body?: unknown) =>
  action({ request: post(body), params: { eventId: EVENT_ID }, context: {} } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "applicant-1", email: "applicant@dali.edu", type: "dartmouth" },
  } as never);
  vi.mocked(getUserRoles).mockResolvedValue({} as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(selfCheckInToEvent).mockResolvedValue({ ok: true, alreadyPresent: false } as never);
});

describe("POST /api/hiring/events/:eventId/check-in", () => {
  it("checks in the session user", async () => {
    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyPresent: false });
    expect(selfCheckInToEvent).toHaveBeenCalledWith({ eventId: EVENT_ID, userId: "applicant-1" });
  });

  it("ignores any userId in the body and uses the session user instead", async () => {
    const res = await run({ userId: "someone-else" });
    expect(res.status).toBe(200);
    expect(selfCheckInToEvent).toHaveBeenCalledWith({ eventId: EVENT_ID, userId: "applicant-1" });
  });

  it("404s when the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const res = await run();
    expect(res.status).toBe(404);
    expect(selfCheckInToEvent).not.toHaveBeenCalled();
  });

  it("redirects/401s when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);
    const res = await run();
    expect(res.status).toBe(401);
    expect(selfCheckInToEvent).not.toHaveBeenCalled();
  });

  it("surfaces a closed check-in window as the lib's error/status", async () => {
    vi.mocked(selfCheckInToEvent).mockResolvedValue({
      error: "Check-in isn't open for this event",
      status: 403,
    } as never);
    const res = await run();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not open|isn't open/i);
  });

  it("reports alreadyPresent on a repeat scan", async () => {
    vi.mocked(selfCheckInToEvent).mockResolvedValue({ ok: true, alreadyPresent: true } as never);
    const res = await run();
    expect(await res.json()).toEqual({ ok: true, alreadyPresent: true });
  });
});
