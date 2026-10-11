import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(), isCycleAdmin: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/hiring/lib/hiring-events.server", () => ({
  deleteHiringEvent: vi.fn(),
  getEventRoster: vi.fn(),
  markEventAttendance: vi.fn(),
  setEventCheckInOpen: vi.fn(),
  updateHiringEvent: vi.fn(),
}));
vi.mock("~/hiring/lib/hiring-event-notice", () => ({ sendEventAnnouncement: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles, isCycleAdmin } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import {
  deleteHiringEvent,
  getEventRoster,
  markEventAttendance,
  setEventCheckInOpen,
  updateHiringEvent,
} from "~/hiring/lib/hiring-events.server";
import { sendEventAnnouncement } from "~/hiring/lib/hiring-event-notice";
import { loader, action } from "~/hiring/routes/api.events.$eventId";

const EVENT_ID = "evt-1";
const CYCLE_ID = "cycle-1";

const mockPrisma = prisma as unknown as { hiringEvent: { findUnique: ReturnType<typeof vi.fn> } };

function get(): Request {
  return new Request(`http://localhost/api/hiring/events/${EVENT_ID}`, { method: "GET" });
}
function post(body: unknown): Request {
  return new Request(`http://localhost/api/hiring/events/${EVENT_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const runLoader = () =>
  loader({ request: get(), params: { eventId: EVENT_ID }, context: {} } as never) as Promise<Response>;
const runAction = (body: unknown) =>
  action({ request: post(body), params: { eventId: EVENT_ID }, context: {} } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).hiringEvent = {
    findUnique: vi.fn().mockResolvedValue({ applicationCycleId: CYCLE_ID }),
  };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "core-1", email: "core@dali.edu", type: "member" },
  } as never);
  vi.mocked(getUserRoles).mockResolvedValue({} as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(isCycleAdmin).mockResolvedValue(true);
  vi.mocked(getEventRoster).mockResolvedValue([]);
  vi.mocked(updateHiringEvent).mockResolvedValue({ ok: true, event: { id: EVENT_ID } } as never);
  vi.mocked(deleteHiringEvent).mockResolvedValue({ ok: true } as never);
  vi.mocked(setEventCheckInOpen).mockResolvedValue({ ok: true } as never);
  vi.mocked(markEventAttendance).mockResolvedValue({ ok: true } as never);
  vi.mocked(sendEventAnnouncement).mockResolvedValue({
    outcome: "sent",
    attempted: 1,
    succeeded: 1,
    failed: 0,
    alreadySent: 0,
  } as never);
});

describe("GET /api/hiring/events/:eventId (roster)", () => {
  it("returns the roster for a Core actor", async () => {
    const res = await runLoader();
    expect(res.status).toBe(200);
    expect(getEventRoster).toHaveBeenCalledWith(EVENT_ID);
  });

  it("404s when the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const res = await runLoader();
    expect(res.status).toBe(404);
    expect(getEventRoster).not.toHaveBeenCalled();
  });

  it("gates reads with isCycleAdmin (getEventRoster itself doesn't gate)", async () => {
    vi.mocked(isCycleAdmin).mockResolvedValue(false);
    const res = await runLoader();
    expect(res.status).toBe(403);
    expect(getEventRoster).not.toHaveBeenCalled();
  });

  it("404s when the event doesn't exist", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(null);
    const res = await runLoader();
    expect(res.status).toBe(404);
  });
});

describe("POST /api/hiring/events/:eventId (intents)", () => {
  it("404s when the flag is off, regardless of intent", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const res = await runAction({ intent: "delete" });
    expect(res.status).toBe(404);
    expect(deleteHiringEvent).not.toHaveBeenCalled();
  });

  it("update: forwards provided fields and the actor", async () => {
    const res = await runAction({ intent: "update", title: "New title" });
    expect(res.status).toBe(200);
    expect(updateHiringEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT_ID, actorId: "core-1", title: "New title" }),
    );
  });

  it("delete: surfaces the lib's result", async () => {
    const res = await runAction({ intent: "delete" });
    expect(res.status).toBe(200);
    expect(deleteHiringEvent).toHaveBeenCalledWith({ eventId: EVENT_ID, actorId: "core-1" });
  });

  it("delete: a non-Core actor gets the lib's 403", async () => {
    vi.mocked(deleteHiringEvent).mockResolvedValue({ error: "Forbidden", status: 403 } as never);
    const res = await runAction({ intent: "delete" });
    expect(res.status).toBe(403);
  });

  it("set-check-in: toggles open", async () => {
    const res = await runAction({ intent: "set-check-in", open: true });
    expect(res.status).toBe(200);
    expect(setEventCheckInOpen).toHaveBeenCalledWith({ eventId: EVENT_ID, open: true, actorId: "core-1" });
  });

  it("set-check-in: 400s without 'open'", async () => {
    const res = await runAction({ intent: "set-check-in" });
    expect(res.status).toBe(400);
    expect(setEventCheckInOpen).not.toHaveBeenCalled();
  });

  it("mark-attendance (explicit intent): marks the given user present", async () => {
    const res = await runAction({ intent: "mark-attendance", userId: "u1", present: true });
    expect(res.status).toBe(200);
    expect(markEventAttendance).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      actorId: "core-1",
      userId: "u1",
      present: true,
    });
  });

  it("mark-attendance: a bare {userId, present} body with no intent defaults to mark-attendance (AttendanceChecklist's shape)", async () => {
    const res = await runAction({ userId: "u1", present: false, occurrence: "2026-01-01T00:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(markEventAttendance).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      actorId: "core-1",
      userId: "u1",
      present: false,
    });
  });

  it("send-announcement: gates with isCycleAdmin since the lib doesn't", async () => {
    vi.mocked(isCycleAdmin).mockResolvedValue(false);
    const res = await runAction({ intent: "send-announcement" });
    expect(res.status).toBe(403);
    expect(sendEventAnnouncement).not.toHaveBeenCalled();
  });

  it("send-announcement: calls the lib and returns its outcome for a Core actor", async () => {
    const res = await runAction({ intent: "send-announcement" });
    expect(res.status).toBe(200);
    expect(sendEventAnnouncement).toHaveBeenCalledWith(EVENT_ID, "core-1");
    expect(await res.json()).toEqual({
      outcome: "sent",
      attempted: 1,
      succeeded: 1,
      failed: 0,
      alreadySent: 0,
    });
  });

  it("400s an unknown/absent intent", async () => {
    const res = await runAction({ foo: "bar" });
    expect(res.status).toBe(400);
  });
});
