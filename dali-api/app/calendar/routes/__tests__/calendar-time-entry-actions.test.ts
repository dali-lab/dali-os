// The timesheet writes answer as soon as Postgres has the row; the Google
// mirror runs behind the response so the grid isn't held on it.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
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

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { resolveRoleRef } from "~/lib/roles";
import { syncTimeEntryToGoogle, removeTimeEntryFromGoogle } from "~/lib/timesheet-mirror.server";
import { markCalendarChanged } from "~/calendar/lib/external-cache.server";
import { submitCalendarAction, timeEntryResult } from "~/calendar/routes/calendar.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
};
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
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => unknown)(prisma));
  mockPrisma.$executeRaw.mockResolvedValue(0);
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
  beforeEach(() => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(row);
  });

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
    await flush();
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
    expect(mockMark).toHaveBeenCalledTimes(2);

    finishMirror();
    await flush();

    expect(mockMark).toHaveBeenCalledTimes(3);
    expect(mockMark).toHaveBeenLastCalledWith("member-1");
  });

  it("marks the calendar changed even when the mirror fails", async () => {
    mockPrisma.timeEntry.create.mockResolvedValue(row);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSync.mockRejectedValue(new Error("nope"));

    await submitCalendarAction(request(addFields));
    await flush();

    expect(mockMark).toHaveBeenCalledTimes(3);
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
    expect(mockMark).toHaveBeenCalledTimes(3);
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
    expect(mockMark).toHaveBeenCalledTimes(3);
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

  it("answers ok when the entry is already gone, without touching Google", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(null);

    const res = await submitCalendarAction(request(deleteFields));
    await flush();

    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ ok: true, entry: { id: "t1" } });
    expect(mockPrisma.timeEntry.delete).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("answers ok to a second delete of the same entry", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    mockPrisma.timeEntry.delete.mockResolvedValue(row);

    const first = await submitCalendarAction(request(deleteFields));
    const second = await submitCalendarAction(request(deleteFields));
    await flush();

    expect(first!.status).toBe(200);
    expect(second!.status).toBe(200);
    expect(mockPrisma.timeEntry.delete).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});

describe("mirroring one entry from several quick writes", () => {
  const settle = () => new Promise((r) => setTimeout(r, 80));
  let saved: { googleTimesheetEventId: string | null };
  let calls: string[];

  beforeEach(() => {
    saved = { googleTimesheetEventId: null };
    calls = [];
    const current = () => ({ ...row, ...saved });
    mockPrisma.timeEntry.create.mockResolvedValue({ ...row, googleTimesheetEventId: null });
    mockPrisma.timeEntry.findUnique.mockImplementation(async () => current());
    mockPrisma.timeEntry.update.mockImplementation(async () => current());
    mockPrisma.timeEntry.delete.mockImplementation(async () => current());
    mockSync.mockImplementation(async (entry: { googleTimesheetEventId: string | null }) => {
      if (entry.googleTimesheetEventId) {
        calls.push("patch");
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
      saved.googleTimesheetEventId = "g1";
      calls.push("insert");
    });
    mockRemove.mockImplementation(async (entry: { googleTimesheetEventId: string | null }) => {
      calls.push(`remove:${entry.googleTimesheetEventId}`);
    });
  });

  it("patches the event an add just created instead of inserting a second one", async () => {
    await submitCalendarAction(request(addFields));
    await submitCalendarAction(request({ intent: "update-time-entry", id: "t1", note: "Edited" }));
    await settle();

    expect(calls).toEqual(["insert", "patch"]);
  });

  it("takes down the event an add just created instead of orphaning it", async () => {
    await submitCalendarAction(request(addFields));
    await submitCalendarAction(request({ intent: "delete-time-entry", id: "t1" }));
    await settle();

    expect(calls).toEqual(["insert", "remove:g1"]);
  });

  it("runs two quick updates in order", async () => {
    saved.googleTimesheetEventId = "g1";
    await submitCalendarAction(request({ intent: "update-time-entry", id: "t1", note: "One" }));
    await submitCalendarAction(request({ intent: "update-time-entry", id: "t1", note: "Two" }));
    await settle();

    expect(calls).toEqual(["patch", "patch"]);
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  it("does not hold up writes to a different entry", async () => {
    mockPrisma.timeEntry.create.mockResolvedValueOnce({ ...row, id: "t2", googleTimesheetEventId: null });
    await submitCalendarAction(request(addFields));
    mockPrisma.timeEntry.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...row,
      id: where.id,
      ...saved,
    }));
    const res = await submitCalendarAction(request({ intent: "delete-time-entry", id: "t9" }));

    expect(res!.status).toBe(200);
    await settle();
  });
});

describe("the stamp around a write", () => {
  it("stamps the change marker after the handler as well as before it", async () => {
    mockPrisma.timeEntry.create.mockImplementation(async () => {
      order.push("write");
      return row;
    });
    const order: string[] = [];
    mockMark.mockImplementation(async () => {
      order.push("stamp");
    });
    mockPrisma.timeEntry.findUnique.mockResolvedValue(row);

    await submitCalendarAction(request(addFields));

    expect(order.slice(0, 3)).toEqual(["stamp", "write", "stamp"]);
  });

  it("stamps again when the handler throws", async () => {
    mockPrisma.timeEntry.create.mockRejectedValue(new Error("db down"));

    await expect(submitCalendarAction(request(addFields))).rejects.toThrow("db down");

    expect(mockMark).toHaveBeenCalledTimes(2);
  });

  it("does not stamp for a write that cannot change a Google read", async () => {
    await submitCalendarAction(request({ intent: "set-event-buffer", minutes: "10" }));

    expect(mockMark).not.toHaveBeenCalled();
  });
});

describe("the cross-machine mirror lock", () => {
  const order: string[] = [];

  beforeEach(() => {
    order.length = 0;
    mockPrisma.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      order.push(`lock:${strings.join("?")}:${values.join(",")}`);
      return 0;
    });
    mockPrisma.timeEntry.findUnique.mockImplementation(async () => {
      order.push("read");
      return row;
    });
  });

  it("takes the entry's advisory lock, re-reads the row, then calls Google, all in one transaction", async () => {
    mockPrisma.timeEntry.update.mockResolvedValue(row);
    mockSync.mockImplementation(async () => {
      order.push("google");
    });

    await submitCalendarAction(request({ intent: "update-time-entry", id: "t1", note: "Edited" }));
    await flush();

    expect(order.slice(-3)).toEqual([
      expect.stringContaining("lock:SELECT pg_advisory_xact_lock(hashtext("),
      "read",
      "google",
    ]);
    expect(order.find((o) => o.startsWith("lock:"))).toContain("timesheet-mirror:t1");
    expect(mockPrisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ timeout: 30_000 }));
  });

  it("reads and deletes the row under the lock on delete, so a mirror elsewhere has saved its Google id", async () => {
    mockPrisma.timeEntry.delete.mockImplementation(async () => {
      order.push("delete");
      return row;
    });
    mockRemove.mockImplementation(async () => {
      order.push("google");
    });

    await submitCalendarAction(request({ intent: "delete-time-entry", id: "t1" }));
    await flush();

    expect(order.slice(0, 3)).toEqual([expect.stringContaining("timesheet-mirror:t1"), "read", "delete"]);
    expect(mockRemove).toHaveBeenCalledWith(row);
  });

  it("does not call Google for a row that was deleted before the job got the lock", async () => {
    mockPrisma.timeEntry.update.mockResolvedValue(row);
    mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(row).mockResolvedValue(null);

    await submitCalendarAction(request({ intent: "update-time-entry", id: "t1", note: "Edited" }));
    await flush();

    expect(mockSync).not.toHaveBeenCalled();
  });
});
