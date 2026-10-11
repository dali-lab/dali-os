import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles");
vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { isCycleAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  isEventCheckInOpen,
  setEventCheckInOpen,
  selfCheckInToEvent,
  markEventAttendance,
  createHiringEvent,
  updateHiringEvent,
  deleteHiringEvent,
  listHiringEvents,
  getEventRoster,
  getHiringEventEngagement,
} from "~/hiring/lib/hiring-events.server";

const mockPrisma = prisma as unknown as {
  hiringEvent: Record<string, ReturnType<typeof vi.fn>>;
  hiringEventAttendance: Record<string, ReturnType<typeof vi.fn>>;
  application: Record<string, ReturnType<typeof vi.fn>>;
  user: Record<string, ReturnType<typeof vi.fn>>;
};

const CYCLE_ID = "cycle-1";
const EVENT_ID = "event-1";
const ACTOR_ID = "actor-1";
const USER_ID = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCycleAdmin).mockResolvedValue(true);
});

describe("isEventCheckInOpen", () => {
  const endsAt = new Date("2026-10-14T20:00:00Z");

  it("is closed when checkInOpenAt is null", () => {
    expect(isEventCheckInOpen({ endsAt, checkInOpenAt: null }, new Date("2026-10-14T19:00:00Z"))).toBe(
      false,
    );
  });

  it("is open before the event ends", () => {
    expect(
      isEventCheckInOpen(
        { endsAt, checkInOpenAt: new Date("2026-10-14T19:00:00Z") },
        new Date("2026-10-14T19:30:00Z"),
      ),
    ).toBe(true);
  });

  it("stays open through the 30-minute grace window", () => {
    expect(
      isEventCheckInOpen(
        { endsAt, checkInOpenAt: new Date("2026-10-14T19:00:00Z") },
        new Date("2026-10-14T20:29:00Z"),
      ),
    ).toBe(true);
  });

  it("closes once the grace window passes", () => {
    expect(
      isEventCheckInOpen(
        { endsAt, checkInOpenAt: new Date("2026-10-14T19:00:00Z") },
        new Date("2026-10-14T20:31:00Z"),
      ),
    ).toBe(false);
  });
});

describe("setEventCheckInOpen", () => {
  it("404s when the event doesn't exist", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(null);
    const result = await setEventCheckInOpen({ eventId: EVENT_ID, open: true, actorId: ACTOR_ID });
    expect(result).toEqual({ error: "Event not found", status: 404 });
  });

  it("403s when the actor isn't the cycle admin", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue({ applicationCycleId: CYCLE_ID });
    vi.mocked(isCycleAdmin).mockResolvedValue(false);
    const result = await setEventCheckInOpen({ eventId: EVENT_ID, open: true, actorId: ACTOR_ID });
    expect(result).toEqual({ error: "Forbidden", status: 403 });
  });

  it("stamps checkInOpenAt when opening and audits", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue({ applicationCycleId: CYCLE_ID });
    mockPrisma.hiringEvent.update.mockResolvedValue({});
    const result = await setEventCheckInOpen({ eventId: EVENT_ID, open: true, actorId: ACTOR_ID });
    expect(result).toEqual({ ok: true });
    expect(mockPrisma.hiringEvent.update).toHaveBeenCalledWith({
      where: { id: EVENT_ID },
      data: { checkInOpenAt: expect.any(Date) },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "hiring.event.checkin.open" }),
    );
  });

  it("clears checkInOpenAt when closing and audits", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue({ applicationCycleId: CYCLE_ID });
    mockPrisma.hiringEvent.update.mockResolvedValue({});
    await setEventCheckInOpen({ eventId: EVENT_ID, open: false, actorId: ACTOR_ID });
    expect(mockPrisma.hiringEvent.update).toHaveBeenCalledWith({
      where: { id: EVENT_ID },
      data: { checkInOpenAt: null },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "hiring.event.checkin.close" }),
    );
  });
});

describe("selfCheckInToEvent", () => {
  it("404s when the event doesn't exist", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(null);
    const result = await selfCheckInToEvent({ eventId: EVENT_ID, userId: USER_ID });
    expect(result).toEqual({ error: "Event not found", status: 404 });
  });

  it("403s when check-in is closed", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue({
      id: EVENT_ID,
      endsAt: new Date("2026-10-14T20:00:00Z"),
      checkInOpenAt: null,
    });
    const result = await selfCheckInToEvent({ eventId: EVENT_ID, userId: USER_ID });
    expect(result).toEqual({ error: "Check-in isn't open for this event", status: 403 });
  });

  it("reports alreadyPresent without re-marking", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue({
      id: EVENT_ID,
      endsAt: new Date("2099-01-01T00:00:00Z"),
      checkInOpenAt: new Date(),
    });
    mockPrisma.hiringEventAttendance.findUnique.mockResolvedValue({ id: "att-1" });
    const result = await selfCheckInToEvent({ eventId: EVENT_ID, userId: USER_ID });
    expect(result).toEqual({ ok: true, alreadyPresent: true });
    expect(mockPrisma.hiringEventAttendance.upsert).not.toHaveBeenCalled();
  });

  it("marks present as self (markedByUserId null) and audits", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue({
      id: EVENT_ID,
      endsAt: new Date("2099-01-01T00:00:00Z"),
      checkInOpenAt: new Date(),
    });
    mockPrisma.hiringEventAttendance.findUnique.mockResolvedValue(null);
    mockPrisma.hiringEventAttendance.upsert.mockResolvedValue({});
    const result = await selfCheckInToEvent({ eventId: EVENT_ID, userId: USER_ID });
    expect(result).toEqual({ ok: true, alreadyPresent: false });
    expect(mockPrisma.hiringEventAttendance.upsert).toHaveBeenCalledWith({
      where: { eventId_userId: { eventId: EVENT_ID, userId: USER_ID } },
      create: { eventId: EVENT_ID, userId: USER_ID, markedByUserId: null },
      update: {},
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "hiring.event.checkin.self" }),
    );
  });
});

describe("markEventAttendance", () => {
  beforeEach(() => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue({ applicationCycleId: CYCLE_ID });
  });

  it("403s when the actor isn't the cycle admin", async () => {
    vi.mocked(isCycleAdmin).mockResolvedValue(false);
    const result = await markEventAttendance({
      eventId: EVENT_ID,
      actorId: ACTOR_ID,
      userId: USER_ID,
      present: true,
    });
    expect(result).toEqual({ error: "Forbidden", status: 403 });
  });

  it("upserts with markedByUserId = actorId when present", async () => {
    mockPrisma.hiringEventAttendance.upsert.mockResolvedValue({});
    const result = await markEventAttendance({
      eventId: EVENT_ID,
      actorId: ACTOR_ID,
      userId: USER_ID,
      present: true,
    });
    expect(result).toEqual({ ok: true });
    expect(mockPrisma.hiringEventAttendance.upsert).toHaveBeenCalledWith({
      where: { eventId_userId: { eventId: EVENT_ID, userId: USER_ID } },
      create: { eventId: EVENT_ID, userId: USER_ID, markedByUserId: ACTOR_ID },
      update: { markedByUserId: ACTOR_ID, markedAt: expect.any(Date) },
    });
  });

  it("deletes the attendance row when absent", async () => {
    mockPrisma.hiringEventAttendance.deleteMany.mockResolvedValue({ count: 1 });
    const result = await markEventAttendance({
      eventId: EVENT_ID,
      actorId: ACTOR_ID,
      userId: USER_ID,
      present: false,
    });
    expect(result).toEqual({ ok: true });
    expect(mockPrisma.hiringEventAttendance.deleteMany).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID, userId: USER_ID },
    });
  });

  it("audits the mark", async () => {
    mockPrisma.hiringEventAttendance.upsert.mockResolvedValue({});
    await markEventAttendance({ eventId: EVENT_ID, actorId: ACTOR_ID, userId: USER_ID, present: true });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "hiring.event.attendance.mark",
        metadata: { userId: USER_ID, present: true },
      }),
    );
  });
});

describe("createHiringEvent", () => {
  const BASE = {
    cycleId: CYCLE_ID,
    actorId: ACTOR_ID,
    kind: "HelpHour" as const,
    title: "Application help hour",
    startsAt: new Date("2026-10-14T20:00:00Z"),
    endsAt: new Date("2026-10-14T21:00:00Z"),
  };

  it("403s when the actor isn't the cycle admin", async () => {
    vi.mocked(isCycleAdmin).mockResolvedValue(false);
    const result = await createHiringEvent(BASE);
    expect(result).toEqual({ error: "Forbidden", status: 403 });
  });

  it("rejects an empty title", async () => {
    const result = await createHiringEvent({ ...BASE, title: "   " });
    expect(result).toEqual({ error: "Title is required", status: 400 });
  });

  it("rejects endsAt at or before startsAt", async () => {
    const result = await createHiringEvent({ ...BASE, endsAt: BASE.startsAt });
    expect(result).toEqual({ error: "End time must be after start time", status: 400 });
  });

  it("creates the event and audits", async () => {
    mockPrisma.hiringEvent.create.mockResolvedValue({ id: EVENT_ID, ...BASE });
    const result = await createHiringEvent(BASE);
    expect(result).toEqual({ ok: true, event: { id: EVENT_ID, ...BASE } });
    expect(mockPrisma.hiringEvent.create).toHaveBeenCalledWith({
      data: {
        applicationCycleId: CYCLE_ID,
        kind: "HelpHour",
        title: "Application help hour",
        startsAt: BASE.startsAt,
        endsAt: BASE.endsAt,
        location: null,
        createdByUserId: ACTOR_ID,
      },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "hiring.event.create" }),
    );
  });
});

describe("updateHiringEvent", () => {
  const EXISTING = {
    id: EVENT_ID,
    applicationCycleId: CYCLE_ID,
    title: "Old title",
    startsAt: new Date("2026-10-14T20:00:00Z"),
    endsAt: new Date("2026-10-14T21:00:00Z"),
  };

  it("404s when the event doesn't exist", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(null);
    const result = await updateHiringEvent({ eventId: EVENT_ID, actorId: ACTOR_ID, title: "New" });
    expect(result).toEqual({ error: "Event not found", status: 404 });
  });

  it("validates against the merged fields, not just the patch", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(EXISTING);
    const result = await updateHiringEvent({
      eventId: EVENT_ID,
      actorId: ACTOR_ID,
      startsAt: new Date("2026-10-14T22:00:00Z"), // after the existing endsAt
    });
    expect(result).toEqual({ error: "End time must be after start time", status: 400 });
  });

  it("updates only the given fields and audits", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(EXISTING);
    mockPrisma.hiringEvent.update.mockResolvedValue({ ...EXISTING, title: "New title" });
    const result = await updateHiringEvent({
      eventId: EVENT_ID,
      actorId: ACTOR_ID,
      title: "New title",
    });
    expect(result).toEqual({ ok: true, event: { ...EXISTING, title: "New title" } });
    expect(mockPrisma.hiringEvent.update).toHaveBeenCalledWith({
      where: { id: EVENT_ID },
      data: {
        title: "New title",
        startsAt: EXISTING.startsAt,
        endsAt: EXISTING.endsAt,
      },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "hiring.event.update" }),
    );
  });
});

describe("deleteHiringEvent", () => {
  it("404s when the event doesn't exist", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(null);
    const result = await deleteHiringEvent({ eventId: EVENT_ID, actorId: ACTOR_ID });
    expect(result).toEqual({ error: "Event not found", status: 404 });
  });

  it("403s when the actor isn't the cycle admin", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue({ applicationCycleId: CYCLE_ID });
    vi.mocked(isCycleAdmin).mockResolvedValue(false);
    const result = await deleteHiringEvent({ eventId: EVENT_ID, actorId: ACTOR_ID });
    expect(result).toEqual({ error: "Forbidden", status: 403 });
  });

  it("deletes and audits", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue({ applicationCycleId: CYCLE_ID });
    mockPrisma.hiringEvent.delete.mockResolvedValue({});
    const result = await deleteHiringEvent({ eventId: EVENT_ID, actorId: ACTOR_ID });
    expect(result).toEqual({ ok: true });
    expect(mockPrisma.hiringEvent.delete).toHaveBeenCalledWith({ where: { id: EVENT_ID } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "hiring.event.delete" }),
    );
  });
});

describe("listHiringEvents", () => {
  it("orders by startsAt and includes the attendance count", async () => {
    mockPrisma.hiringEvent.findMany.mockResolvedValue([]);
    await listHiringEvents(CYCLE_ID);
    expect(mockPrisma.hiringEvent.findMany).toHaveBeenCalledWith({
      where: { applicationCycleId: CYCLE_ID },
      orderBy: { startsAt: "asc" },
      include: { _count: { select: { attendances: true } } },
    });
  });
});

describe("getEventRoster", () => {
  it("returns [] when the event doesn't exist", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(null);
    expect(await getEventRoster(EVENT_ID)).toEqual([]);
  });

  it("merges applicants with attendance and flags walk-ins", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue({ applicationCycleId: CYCLE_ID });
    mockPrisma.application.findMany.mockResolvedValue([
      {
        userId: "applicant-present",
        user: { firstName: "Alex", lastName: "Chen", dartmouthEmail: "alex.chen@dartmouth.edu", netId: null },
      },
      {
        userId: "applicant-absent",
        user: { firstName: "Bo", lastName: "Diaz", dartmouthEmail: null, netId: "bd123" },
      },
    ]);
    mockPrisma.hiringEventAttendance.findMany.mockResolvedValue([
      { userId: "applicant-present", markedAt: new Date("2026-10-14T20:05:00Z") },
      { userId: "walkin-1", markedAt: new Date("2026-10-14T20:06:00Z") },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "walkin-1", firstName: "Casey", lastName: "Park", dartmouthEmail: null, netId: "cp456" },
    ]);

    const roster = await getEventRoster(EVENT_ID);

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["walkin-1"] } },
      select: { id: true, firstName: true, lastName: true, dartmouthEmail: true, netId: true },
    });

    const byUserId = new Map(roster.map((r) => [r.userId, r]));
    expect(byUserId.get("applicant-present")).toMatchObject({
      name: "Alex Chen",
      email: "alex.chen@dartmouth.edu",
      present: true,
      applicant: true,
    });
    expect(byUserId.get("applicant-absent")).toMatchObject({
      name: "Bo Diaz",
      email: "bd123@dartmouth.edu",
      present: false,
      markedAt: null,
      applicant: true,
    });
    expect(byUserId.get("walkin-1")).toMatchObject({
      name: "Casey Park",
      email: "cp456@dartmouth.edu",
      present: true,
      applicant: false,
    });
    expect(roster).toHaveLength(3);
  });
});

describe("getHiringEventEngagement", () => {
  it("orders newest first and carries cycleId/cycleName per entry", async () => {
    mockPrisma.hiringEventAttendance.findMany.mockResolvedValue([
      {
        event: {
          id: "event-older",
          title: "Fall help hour",
          kind: "HelpHour",
          startsAt: new Date("2025-10-01T00:00:00Z"),
          endsAt: new Date("2025-10-01T01:00:00Z"),
          applicationCycleId: "cycle-prior",
          applicationCycle: { name: "25F" },
        },
      },
    ]);
    const entries = await getHiringEventEngagement(USER_ID);
    expect(mockPrisma.hiringEventAttendance.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: expect.anything(),
      orderBy: { event: { startsAt: "desc" } },
    });
    expect(entries).toEqual([
      {
        eventId: "event-older",
        title: "Fall help hour",
        kind: "HelpHour",
        startsAt: new Date("2025-10-01T00:00:00Z"),
        endsAt: new Date("2025-10-01T01:00:00Z"),
        cycleId: "cycle-prior",
        cycleName: "25F",
      },
    ]);
  });

  it("narrows to the given cycle when cycleId is passed", async () => {
    mockPrisma.hiringEventAttendance.findMany.mockResolvedValue([]);
    await getHiringEventEngagement(USER_ID, CYCLE_ID);
    expect(mockPrisma.hiringEventAttendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, event: { applicationCycleId: CYCLE_ID } },
      }),
    );
  });
});
