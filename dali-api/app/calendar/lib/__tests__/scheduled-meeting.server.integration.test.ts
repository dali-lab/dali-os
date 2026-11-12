import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/notify.server", () => ({ notify: vi.fn(async () => ({})) }));
vi.mock("~/calendar/lib/google-calendar.server", () => ({
  createGoogleCalendarEvent: vi.fn(),
  patchGoogleCalendarEvent: vi.fn(),
  getGoogleEvent: vi.fn(),
  deleteGoogleCalendarEvent: vi.fn(),
}));
vi.mock("~/calendar/lib/meeting-shares.server", () => ({ syncMeetingShares: vi.fn(async () => {}) }));

import { prisma } from "~/lib/db.server";
import { updateScheduledMeeting } from "~/calendar/lib/scheduled-meeting.server";
import { expandOccurrences } from "~/calendar/lib/meeting-occurrences";
import { makeMeeting, makeUser } from "~/lib/__tests__/integration-fixtures.calendar";

const WEEK = 7 * 24 * 3_600_000;
// Wed 2026-09-09 10:00 EDT; no clock change in the six weeks after it.
const FIRST = new Date("2026-09-09T14:00:00Z");
const at = (weeks: number, base = FIRST) => new Date(base.getTime() + weeks * WEEK);
const ALL = { scope: { type: "UserList" as const, participantUserIds: [] as string[] }, title: "Weekly sync", durationMinutes: 60 };
const withGuest = (grace: { id: string }) => ({ ...ALL, scope: { type: "UserList" as const, participantUserIds: [grace.id] } });

beforeEach(() => vi.clearAllMocks());

async function seriesWithKeys(weeks: number[]) {
  const ada = await makeUser();
  const grace = await makeUser("Grace", "Hopper");
  const meeting = await makeMeeting(ada.id, { selectedAt: FIRST, recurrenceRule: "FREQ=WEEKLY;COUNT=6", participantUserIds: [grace.id] });
  for (const w of weeks) {
    await prisma.meetingAttendance.create({
      data: { scheduledMeetingId: meeting.id, userId: grace.id, occurrenceStart: at(w), present: w % 2 === 0 },
    });
    await prisma.timeEntry.create({
      data: { userId: grace.id, source: "Meeting", scheduledMeetingId: meeting.id, occurrenceStart: at(w), date: at(w), hours: 1 },
    });
    await prisma.page.create({
      data: { workspaceType: "Lab", createdById: ada.id, title: `Note ${w}`, meetingNoteId: meeting.id, meetingOccurrenceStart: at(w) },
    });
  }
  return { ada, grace, meeting };
}

const keys = async (meetingId: string) => ({
  attendance: (await prisma.meetingAttendance.findMany({ where: { scheduledMeetingId: meetingId, user: { firstName: "Grace" } }, orderBy: { occurrenceStart: "asc" } })).map((r) => r.occurrenceStart.getTime()),
  entries: (await prisma.timeEntry.findMany({ where: { scheduledMeetingId: meetingId }, orderBy: { occurrenceStart: "asc" } })).map((r) => r.occurrenceStart!.getTime()),
  pages: (await prisma.page.findMany({ where: { meetingNoteId: meetingId }, orderBy: { meetingOccurrenceStart: "asc" } })).map((r) => r.meetingOccurrenceStart!.getTime()),
});

describe("whole-series reschedule shifts occurrence keys", () => {
  it("moves a weekly series one week later without tripping the unique keys", async () => {
    const { ada, grace, meeting } = await seriesWithKeys([0, 1, 2, 3]);
    const r = await updateScheduledMeeting(meeting.id, ada.id, { ...withGuest(grace), recurrenceRule: "FREQ=WEEKLY;COUNT=6", startTime: at(1).toISOString() });
    expect(r.ok).toBe(true);
    const expected = [1, 2, 3, 4].map((w) => at(w).getTime());
    expect(await keys(meeting.id)).toEqual({ attendance: expected, entries: expected, pages: expected });
  });

  it("moves keys earlier, and keeps who was present on the occurrence they belong to", async () => {
    const { ada, grace, meeting } = await seriesWithKeys([0, 1, 2]);
    const earlier = new Date(FIRST.getTime() - 26 * 3_600_000);
    await updateScheduledMeeting(meeting.id, ada.id, { ...withGuest(grace), recurrenceRule: "FREQ=WEEKLY;COUNT=6", startTime: earlier.toISOString() });
    const shift = -26 * 3_600_000;
    const rows = await prisma.meetingAttendance.findMany({ where: { scheduledMeetingId: meeting.id, userId: grace.id }, orderBy: { occurrenceStart: "asc" } });
    expect(rows.map((r) => [r.occurrenceStart.getTime(), r.present])).toEqual([0, 1, 2].map((w) => [at(w).getTime() + shift, w % 2 === 0]));
  });

  it("measures the move from the instance that was clicked", async () => {
    const { ada, grace, meeting } = await seriesWithKeys([0, 1, 2]);
    // Week 2's instance dragged an hour later: every key shifts by that hour.
    const clicked = at(2);
    const r = await updateScheduledMeeting(meeting.id, ada.id, {
      ...withGuest(grace),
      recurrenceRule: "FREQ=WEEKLY;COUNT=6",
      startTime: new Date(clicked.getTime() + 3_600_000).toISOString(),
      occurrenceStart: clicked.toISOString(),
    });
    expect(r.ok).toBe(true);
    const expected = [0, 1, 2].map((w) => at(w).getTime() + 3_600_000);
    expect((await keys(meeting.id)).attendance).toEqual(expected);
  });

  it("leaves other meetings' keys alone", async () => {
    const { ada, grace, meeting } = await seriesWithKeys([0, 1]);
    const other = await seriesWithKeys([0, 1]);
    await updateScheduledMeeting(meeting.id, ada.id, { ...withGuest(grace), recurrenceRule: "FREQ=WEEKLY;COUNT=6", startTime: at(1).toISOString() });
    expect(await keys(other.meeting.id)).toEqual({
      attendance: [0, 1].map((w) => at(w).getTime()),
      entries: [0, 1].map((w) => at(w).getTime()),
      pages: [0, 1].map((w) => at(w).getTime()),
    });
  });

  it("does not touch keys when the start time is unchanged", async () => {
    const { ada, grace, meeting } = await seriesWithKeys([0, 1]);
    await updateScheduledMeeting(meeting.id, ada.id, { ...withGuest(grace), title: "Renamed", recurrenceRule: "FREQ=WEEKLY;COUNT=6", startTime: FIRST.toISOString() });
    expect((await keys(meeting.id)).attendance).toEqual([0, 1].map((w) => at(w).getTime()));
  });
});

describe("this and following split", () => {
  const split = (meetingId: string, actor: string, occ: Date, extra: object = {}) =>
    updateScheduledMeeting(meetingId, actor, { ...ALL, editScope: "following", occurrenceStart: occ.toISOString(), startTime: occ.toISOString(), ...extra });

  const allStarts = (rule: string | null, selectedAt: Date | null) =>
    expandOccurrences({ selectedAt, durationMinutes: 60, recurrenceRule: rule }, [], new Date("2026-01-01"), new Date("2027-12-31")).map((o) => o.originalStart.getTime());

  it("cuts a COUNT series: the old one ends before the split, the new one gets the remaining count", async () => {
    const { ada, meeting } = await seriesWithKeys([]);
    const r = await split(meeting.id, ada.id, at(2));
    if (!r.ok) throw new Error(r.error);
    const oldRow = await prisma.scheduledMeeting.findUniqueOrThrow({ where: { id: meeting.id } });
    const newRow = await prisma.scheduledMeeting.findUniqueOrThrow({ where: { id: r.meeting.id } });
    expect(oldRow.recurrenceRule).toMatch(/^FREQ=WEEKLY;UNTIL=\d{8}T\d{6}Z$/);
    expect(oldRow.recurrenceRule).not.toContain("COUNT");
    expect(newRow.recurrenceRule).toBe("FREQ=WEEKLY;COUNT=4");
    expect(newRow.selectedAt).toEqual(at(2));
    expect(newRow.id).not.toBe(meeting.id);
    // Together they are exactly the original six occurrences: none lost, none doubled.
    const original = [0, 1, 2, 3, 4, 5].map((w) => at(w).getTime());
    expect([...allStarts(oldRow.recurrenceRule, oldRow.selectedAt), ...allStarts(newRow.recurrenceRule, newRow.selectedAt)]).toEqual(original);
  });

  it("keeps UNTIL on the new series and truncates the old one just before the split", async () => {
    const { ada, meeting } = await seriesWithKeys([]);
    const until = "20261101T000000Z";
    await prisma.scheduledMeeting.update({ where: { id: meeting.id }, data: { recurrenceRule: `FREQ=WEEKLY;UNTIL=${until}` } });
    const r = await split(meeting.id, ada.id, at(2));
    if (!r.ok) throw new Error(r.error);
    const oldRow = await prisma.scheduledMeeting.findUniqueOrThrow({ where: { id: meeting.id } });
    const newRow = await prisma.scheduledMeeting.findUniqueOrThrow({ where: { id: r.meeting.id } });
    expect(newRow.recurrenceRule).toBe(`FREQ=WEEKLY;UNTIL=${until}`);
    const cut = new Date(at(2).getTime() - 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    expect(oldRow.recurrenceRule).toBe(`FREQ=WEEKLY;UNTIL=${cut}`);
    const oldStarts = allStarts(oldRow.recurrenceRule, oldRow.selectedAt);
    const newStarts = allStarts(newRow.recurrenceRule, newRow.selectedAt);
    expect(oldStarts).toEqual([0, 1].map((w) => at(w).getTime()));
    expect(newStarts[0]).toBe(at(2).getTime());
    expect(newStarts.at(-1)!).toBeLessThan(new Date("2026-11-01T00:00:00Z").getTime());
    expect(new Set([...oldStarts, ...newStarts]).size).toBe(oldStarts.length + newStarts.length);
  });

  it("an open-ended series stays open-ended on both sides", async () => {
    const { ada, meeting } = await seriesWithKeys([]);
    await prisma.scheduledMeeting.update({ where: { id: meeting.id }, data: { recurrenceRule: "FREQ=WEEKLY" } });
    const r = await split(meeting.id, ada.id, at(3));
    if (!r.ok) throw new Error(r.error);
    expect(r.meeting.recurrenceRule).toBe("FREQ=WEEKLY");
    expect((await prisma.scheduledMeeting.findUniqueOrThrow({ where: { id: meeting.id } })).recurrenceRule).toMatch(/UNTIL=/);
  });

  it("hands the split occurrence's note to the new series and leaves earlier notes behind", async () => {
    const { ada, meeting } = await seriesWithKeys([0, 1, 2, 3]);
    const r = await split(meeting.id, ada.id, at(2));
    if (!r.ok) throw new Error(r.error);
    const moved = await prisma.page.findMany({ where: { meetingNoteId: r.meeting.id } });
    expect(moved.map((p) => [p.title, p.meetingOccurrenceStart!.getTime()])).toEqual([["Note 2", at(2).getTime()]]);
    expect((await keys(meeting.id)).pages).toEqual([0, 1, 3].map((w) => at(w).getTime()));
  });

  it("carries the edited title and the master's organizer to the new series", async () => {
    const { ada, meeting } = await seriesWithKeys([]);
    const r = await split(meeting.id, ada.id, at(1), { title: "Renamed from here" });
    if (!r.ok) throw new Error(r.error);
    expect(r.meeting).toMatchObject({ title: "Renamed from here", organizerId: ada.id });
    expect((await prisma.scheduledMeeting.findUniqueOrThrow({ where: { id: meeting.id } })).title).toBe("Weekly sync");
  });
});
