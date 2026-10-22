// The timesheet writes answer as soon as Postgres has the row; the Google
// mirror runs behind the response so the grid isn't held on it.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/roles")>()),
  resolveRoleRef: vi.fn(),
}));
vi.mock("~/lib/timesheet-mirror.server", () => ({
  setUserTimesheetSync: vi.fn(),
  syncTimeEntryToGoogle: vi.fn(),
  removeTimeEntryFromGoogle: vi.fn(),
}));
vi.mock("~/calendar/lib/external-cache.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/calendar/lib/external-cache.server")>()),
  markCalendarChanged: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { resolveRoleRef } from "~/lib/roles";
import { syncTimeEntryToGoogle, removeTimeEntryFromGoogle } from "~/lib/timesheet-mirror.server";
import { markCalendarChanged } from "~/calendar/lib/external-cache.server";
import { submitCalendarAction, timeEntryResult } from "~/calendar/routes/calendar.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockSync = syncTimeEntryToGoogle as ReturnType<typeof vi.fn>;
const mockRemove = removeTimeEntryFromGoogle as ReturnType<typeof vi.fn>;
const mockMark = markCalendarChanged as ReturnType<typeof vi.fn>;

const request = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://localhost/calendar", { method: "POST", body });
};

const row = {
  id: "t1",
  userId: "member-1",
  hours: 2,
  note: "Worked",
  date: new Date("2026-10-21T00:00:00.000Z"),
  startTime: new Date("2026-10-21T13:00:00.000Z"),
  endTime: new Date("2026-10-21T15:00:00.000Z"),
  assignmentType: "Project",
  roleRefId: "r1",
  projectId: null,
  googleTimesheetEventId: "g1",
  googleTimesheetLinkId: "l1",
};

const addFields = {
  intent: "add-time-entry",
  date: "2026-10-21",
  hours: "2",
  assignmentType: "Project",
  roleRefId: "r1",
  note: "Worked",
  startTime: "2026-10-21T13:00:00.000Z",
  endTime: "2026-10-21T15:00:00.000Z",
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
  (resolveRoleRef as ReturnType<typeof vi.fn>).mockResolvedValue({ projectId: null });
  mockSync.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
  mockMark.mockResolvedValue(undefined);
});

describe("timeEntryResult", () => {
  it("carries the id and the fields the grid draws, as strings", () => {
    expect(timeEntryResult(row)).toEqual({
      id: "t1",
      hours: 2,
      note: "Worked",
      date: "2026-10-21T00:00:00.000Z",
      startTime: "2026-10-21T13:00:00.000Z",
      endTime: "2026-10-21T15:00:00.000Z",
    });
  });

  it("keeps a missing range null", () => {
    expect(timeEntryResult({ ...row, startTime: null, endTime: null })).toMatchObject({ startTime: null, endTime: null });
  });
});

describe("add-time-entry", () => {
  it("answers ok with the saved entry", async () => {
    mockPrisma.timeEntry.create.mockResolvedValue(row);

    const res = await submitCalendarAction(request(addFields));

    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ ok: true, entry: timeEntryResult(row) });
    expect(mockPrisma.timeEntry.create).toHaveBeenCalledTimes(1);
  });

  it("does not wait for the Google mirror before answering", async () => {
    mockPrisma.timeEntry.create.mockResolvedValue(row);
    let finishMirror!: () => void;
    mockSync.mockReturnValue(new Promise<void>((r) => (finishMirror = r)));

    const res = await submitCalendarAction(request(addFields));

    expect(res!.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith(row);
    finishMirror();
    await flush();
  });

  it("writes the row before it calls Google", async () => {
    const order: string[] = [];
    mockPrisma.timeEntry.create.mockImplementation(async () => {
      order.push("db");
      return row;
    });
    mockSync.mockImplementation(async () => {
      order.push("google");
    });

    await submitCalendarAction(request(addFields));
    await flush();

    expect(order).toEqual(["db", "google"]);
  });

  it("still succeeds when the Google mirror fails", async () => {
    mockPrisma.timeEntry.create.mockResolvedValue(row);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSync.mockRejectedValue(new Error("Google is down"));

    const res = await submitCalendarAction(request(addFields));
    await flush();

    expect(res!.status).toBe(200);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("marks the calendar changed again once the mirror has landed", async () => {
    mockPrisma.timeEntry.create.mockResolvedValue(row);
    let finishMirror!: () => void;
    mockSync.mockReturnValue(new Promise<void>((r) => (finishMirror = r)));

    await submitCalendarAction(request(addFields));
    expect(mockMark).toHaveBeenCalledTimes(1);

    finishMirror();
    await flush();

    expect(mockMark).toHaveBeenCalledTimes(2);
    expect(mockMark).toHaveBeenLastCalledWith("member-1");
  });

  it("marks the calendar changed even when the mirror fails", async () => {
    mockPrisma.timeEntry.create.mockResolvedValue(row);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSync.mockRejectedValue(new Error("nope"));

    await submitCalendarAction(request(addFields));
    await flush();

    expect(mockMark).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("rejects a bad range without touching the database or Google", async () => {
    const res = await submitCalendarAction(request({ ...addFields, endTime: "2026-10-21T12:00:00.000Z" }));

    expect(res!.status).toBe(400);
    expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("answers ok for an entry logged against a meeting, without mirroring it", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      selectedAt: null,
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      durationMinutes: 120,
      recurrenceRule: null,
      externalEventId: null,
    });
    mockPrisma.timeEntry.upsert.mockResolvedValue(row);

    const res = await submitCalendarAction(request({ ...addFields, scheduledMeetingId: "m1" }));

    expect(res!.status).toBe(200);
    expect((await res!.json()).ok).toBe(true);
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe("update-time-entry", () => {
  const updateFields = { intent: "update-time-entry", id: "t1", note: "Edited" };

  it("answers ok with the saved entry", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(row);
    const updated = { ...row, note: "Edited" };
    mockPrisma.timeEntry.update.mockResolvedValue(updated);

    const res = await submitCalendarAction(request(updateFields));

    expect(await res!.json()).toEqual({ ok: true, entry: timeEntryResult(updated) });
  });

  it("mirrors in the background and still succeeds when Google fails", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(row);
    mockPrisma.timeEntry.update.mockResolvedValue(row);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSync.mockRejectedValue(new Error("Google is down"));

    const res = await submitCalendarAction(request(updateFields));
    await flush();

    expect(res!.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith(row);
    expect(mockMark).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("refuses someone else's entry", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ ...row, userId: "someone-else" });

    const res = await submitCalendarAction(request(updateFields));

    expect(res!.status).toBe(404);
    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe("delete-time-entry", () => {
  const deleteFields = { intent: "delete-time-entry", id: "t1" };

  it("answers ok with the deleted id", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(row);
    mockPrisma.timeEntry.delete.mockResolvedValue(row);

    const res = await submitCalendarAction(request(deleteFields));

    expect(await res!.json()).toEqual({ ok: true, entry: { id: "t1" } });
    expect(mockPrisma.timeEntry.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });

  it("deletes the row before it removes the Google mirror, using the ids read first", async () => {
    const order: string[] = [];
    mockPrisma.timeEntry.findUnique.mockResolvedValue(row);
    mockPrisma.timeEntry.delete.mockImplementation(async () => {
      order.push("db");
      return row;
    });
    mockRemove.mockImplementation(async () => {
      order.push("google");
    });

    await submitCalendarAction(request(deleteFields));
    await flush();

    expect(order).toEqual(["db", "google"]);
    expect(mockRemove).toHaveBeenCalledWith(row);
  });

  it("does not wait for the Google removal before answering", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(row);
    mockPrisma.timeEntry.delete.mockResolvedValue(row);
    let finish!: () => void;
    mockRemove.mockReturnValue(new Promise<void>((r) => (finish = r)));

    const res = await submitCalendarAction(request(deleteFields));

    expect(res!.status).toBe(200);
    finish();
    await flush();
    expect(mockMark).toHaveBeenCalledTimes(2);
  });

  it("still succeeds when the Google removal fails", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(row);
    mockPrisma.timeEntry.delete.mockResolvedValue(row);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRemove.mockRejectedValue(new Error("Google is down"));

    const res = await submitCalendarAction(request(deleteFields));
    await flush();

    expect(res!.status).toBe(200);
    log.mockRestore();
  });

  it("leaves Google alone when the entry is not the viewer's", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ ...row, userId: "someone-else" });

    const res = await submitCalendarAction(request(deleteFields));

    expect(res!.status).toBe(404);
    expect(mockPrisma.timeEntry.delete).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
