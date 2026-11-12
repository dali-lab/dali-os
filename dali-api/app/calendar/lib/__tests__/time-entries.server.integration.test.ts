import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/calendar/lib/timesheet-mirror.server", () => ({
  syncTimeEntryToGoogle: vi.fn(async () => {}),
  removeTimeEntryFromGoogle: vi.fn(async () => {}),
}));

import { prisma } from "~/lib/db.server";
import { removeTimeEntryFromGoogle, syncTimeEntryToGoogle } from "~/calendar/lib/timesheet-mirror.server";
import { addTimeEntry, deleteTimeEntry, updateTimeEntry } from "~/calendar/lib/time-entries.server";
import { makeCoreAssignment, makeMeeting, makeUser } from "~/lib/__tests__/integration-fixtures.calendar";

const WEEK = 7 * 24 * 3_600_000;
const FIRST = new Date("2026-09-09T14:00:00Z");
const at = (weeks: number) => new Date(FIRST.getTime() + weeks * WEEK);

async function setup() {
  const ada = await makeUser();
  const role = await makeCoreAssignment(ada.id);
  const meeting = await makeMeeting(ada.id, { selectedAt: FIRST, recurrenceRule: "FREQ=WEEKLY;COUNT=6" });
  const input = (start: Date, extra: object = {}) => ({
    date: start.toISOString(),
    hours: 1,
    assignmentType: "Core" as const,
    roleRefId: role.id,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 3_600_000).toISOString(),
    ...extra,
  });
  return { ada, role, meeting, input };
}

const flush = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("meeting-linked time entries", () => {
  it("keys each week of a series on its own original start", async () => {
    const { ada, meeting, input } = await setup();
    for (const w of [0, 1, 2]) {
      const r = await addTimeEntry(ada.id, input(at(w), { scheduledMeetingId: meeting.id }));
      expect(r.ok).toBe(true);
    }
    const rows = await prisma.timeEntry.findMany({ orderBy: { occurrenceStart: "asc" } });
    expect(rows.map((r) => r.occurrenceStart)).toEqual([at(0), at(1), at(2)]);
    expect(rows.every((r) => r.source === "Meeting" && r.scheduledMeetingId === meeting.id)).toBe(true);
    expect(syncTimeEntryToGoogle).not.toHaveBeenCalled();
  });

  it("snaps a slightly-off instant to the occurrence and re-logging updates it in place", async () => {
    const { ada, meeting, input } = await setup();
    await addTimeEntry(ada.id, input(at(1), { scheduledMeetingId: meeting.id, note: "first" }));
    const off = new Date(at(1).getTime() + 5 * 60_000);
    await addTimeEntry(ada.id, input(off, { scheduledMeetingId: meeting.id, note: "second", hours: 1 }));
    const rows = await prisma.timeEntry.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrenceStart).toEqual(at(1));
    expect(rows[0].note).toBe("second");
  });

  it("holds one row per user per occurrence, but each user gets their own", async () => {
    const { ada, meeting, input } = await setup();
    const grace = await makeUser("Grace", "Hopper");
    const graceRole = await makeCoreAssignment(grace.id);
    await addTimeEntry(ada.id, input(at(0), { scheduledMeetingId: meeting.id }));
    await addTimeEntry(grace.id, input(at(0), { scheduledMeetingId: meeting.id, roleRefId: graceRole.id }));
    expect(await prisma.timeEntry.count()).toBe(2);
  });

  it("concurrent logs for the same user and occurrence leave exactly one row", async () => {
    const { ada, meeting, input } = await setup();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => addTimeEntry(ada.id, input(at(0), { scheduledMeetingId: meeting.id, note: `n${i}` }))),
    );
    expect(await prisma.timeEntry.count()).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThan(0);
  });

  it("the database refuses a second row for the same user and occurrence", async () => {
    const { ada, meeting, role } = await setup();
    const data = {
      userId: ada.id,
      source: "Meeting" as const,
      scheduledMeetingId: meeting.id,
      occurrenceStart: at(0),
      date: at(0),
      hours: 1,
      assignmentType: "Core" as const,
      roleRefId: role.id,
    };
    await prisma.timeEntry.create({ data });
    await expect(prisma.timeEntry.create({ data })).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects an unknown meeting without writing", async () => {
    const { ada, input } = await setup();
    const r = await addTimeEntry(ada.id, input(at(0), { scheduledMeetingId: "nope" }));
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  it("rejects a role that belongs to someone else", async () => {
    const { meeting, input } = await setup();
    const grace = await makeUser("Grace", "Hopper");
    const r = await addTimeEntry(grace.id, input(at(0), { scheduledMeetingId: meeting.id }));
    expect(r).toMatchObject({ ok: false, status: 400, error: "Invalid role" });
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});

describe("manual time entries and the mirror lock", () => {
  it("saves a manual entry and mirrors the stored row", async () => {
    const { ada, input } = await setup();
    const r = await addTimeEntry(ada.id, input(at(0)));
    expect(r.ok).toBe(true);
    await flush();
    expect(syncTimeEntryToGoogle).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncTimeEntryToGoogle).mock.calls[0][0]).toMatchObject({ userId: ada.id, source: "Manual" });
  });

  it("updates merge with the stored range and refuse an end before the stored start", async () => {
    const { ada, input } = await setup();
    const created = await addTimeEntry(ada.id, input(at(0)));
    if (!created.ok) throw new Error("setup");
    const bad = await updateTimeEntry(ada.id, { id: created.entry.id, endTime: new Date(at(0).getTime() - 3_600_000).toISOString() });
    expect(bad).toMatchObject({ ok: false, status: 400 });
    const stored = await prisma.timeEntry.findUniqueOrThrow({ where: { id: created.entry.id } });
    expect(stored.endTime).toEqual(new Date(at(0).getTime() + 3_600_000));
  });

  it("another user cannot update or delete an entry", async () => {
    const { ada, input } = await setup();
    const grace = await makeUser("Grace", "Hopper");
    const created = await addTimeEntry(ada.id, input(at(0)));
    if (!created.ok) throw new Error("setup");
    await flush();
    expect(await updateTimeEntry(grace.id, { id: created.entry.id, note: "hax" })).toMatchObject({ ok: false, status: 404 });
    expect(await deleteTimeEntry(grace.id, created.entry.id)).toMatchObject({ ok: false, status: 404 });
    const stored = await prisma.timeEntry.findUniqueOrThrow({ where: { id: created.entry.id } });
    expect(stored.note).toBeNull();
  });

  it("delete waits for an in-flight mirror so removal sees the saved Google event id", async () => {
    const { ada, input } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(syncTimeEntryToGoogle).mockImplementationOnce(async (entry) => {
      await gate;
      await prisma.timeEntry.update({ where: { id: entry.id }, data: { googleTimesheetEventId: "evt-1" } });
    });
    const created = await addTimeEntry(ada.id, input(at(0)));
    if (!created.ok) throw new Error("setup");
    await flush();
    const deleting = deleteTimeEntry(ada.id, created.entry.id);
    await flush();
    expect(removeTimeEntryFromGoogle).not.toHaveBeenCalled();
    release();
    expect(await deleting).toEqual({ ok: true, id: created.entry.id });
    await flush();
    expect(await prisma.timeEntry.count()).toBe(0);
    expect(removeTimeEntryFromGoogle).toHaveBeenCalledTimes(1);
    expect(vi.mocked(removeTimeEntryFromGoogle).mock.calls[0][0]).toMatchObject({ googleTimesheetEventId: "evt-1" });
  });

  it("concurrent deletes of one entry both succeed and the Google event is removed once", async () => {
    const { ada, input } = await setup();
    const created = await addTimeEntry(ada.id, input(at(0)));
    if (!created.ok) throw new Error("setup");
    await flush();
    const results = await Promise.all([deleteTimeEntry(ada.id, created.entry.id), deleteTimeEntry(ada.id, created.entry.id)]);
    expect(results.every((r) => r.ok)).toBe(true);
    await flush();
    expect(await prisma.timeEntry.count()).toBe(0);
    expect(removeTimeEntryFromGoogle).toHaveBeenCalledTimes(1);
  });

  it("two quick updates mirror in order and the last mirror sees the final row", async () => {
    const { ada, input } = await setup();
    const created = await addTimeEntry(ada.id, input(at(0)));
    if (!created.ok) throw new Error("setup");
    await flush();
    vi.mocked(syncTimeEntryToGoogle).mockClear();
    await Promise.all([
      updateTimeEntry(ada.id, { id: created.entry.id, note: "one" }),
      updateTimeEntry(ada.id, { id: created.entry.id, note: "two" }),
    ]);
    await flush();
    const calls = vi.mocked(syncTimeEntryToGoogle).mock.calls;
    expect(calls).toHaveLength(2);
    const final = await prisma.timeEntry.findUniqueOrThrow({ where: { id: created.entry.id } });
    expect(calls[1][0].note).toBe(final.note);
  });
});
