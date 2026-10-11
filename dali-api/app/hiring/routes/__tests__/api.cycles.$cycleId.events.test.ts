import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/hiring/lib/hiring-events.server", () => ({ createHiringEvent: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { createHiringEvent } from "~/hiring/lib/hiring-events.server";
import { action } from "~/hiring/routes/api.cycles.$cycleId.events";

const CYCLE_ID = "cycle-1";

function post(body: unknown): Request {
  return new Request(`http://localhost/api/hiring/cycles/${CYCLE_ID}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const run = (body: unknown) =>
  action({ request: post(body), params: { cycleId: CYCLE_ID }, context: {} } as never) as Promise<Response>;

const validBody = {
  kind: "HelpHour",
  title: "Application help hour",
  startsAt: "2026-10-14T20:00:00.000Z",
  endsAt: "2026-10-14T21:00:00.000Z",
  location: "DALI Lab",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "core-1", email: "core@dali.edu", type: "member" },
  } as never);
  vi.mocked(getUserRoles).mockResolvedValue({} as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(createHiringEvent).mockResolvedValue({
    ok: true,
    event: { id: "evt-1", ...validBody },
  } as never);
});

describe("POST /api/hiring/cycles/:cycleId/events", () => {
  it("creates an event for a Core actor", async () => {
    const res = await run(validBody);
    expect(res.status).toBe(201);
    expect(createHiringEvent).toHaveBeenCalledWith(
      expect.objectContaining({ cycleId: CYCLE_ID, actorId: "core-1", kind: "HelpHour" }),
    );
  });

  it("returns 404 when the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const res = await run(validBody);
    expect(res.status).toBe(404);
    expect(createHiringEvent).not.toHaveBeenCalled();
  });

  it("surfaces the lib's 403 for a non-Core actor", async () => {
    vi.mocked(createHiringEvent).mockResolvedValue({ error: "Forbidden", status: 403 } as never);
    const res = await run(validBody);
    expect(res.status).toBe(403);
  });

  it("400s an invalid body before calling the lib", async () => {
    const res = await run({ kind: "HelpHour", title: "" });
    expect(res.status).toBe(400);
    expect(createHiringEvent).not.toHaveBeenCalled();
  });
});
