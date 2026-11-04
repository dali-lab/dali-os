import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Interviewer calendars come from Google; every interviewer is free all window.
vi.mock("~/hiring/lib/interview-availability.server", () => ({
  interviewerCalendars: vi.fn(async (userIds: string[]) => {
    const free = [{ startTime: new Date("2000-01-01T00:00:00Z"), endTime: new Date("2100-01-01T00:00:00Z") }];
    return new Map(userIds.map((id) => [id, { hasCalendar: true, hasWorkingHours: true, available: free }]));
  }),
}));
vi.mock("~/hiring/lib/interview-emails", () => ({ sendReassignmentEmails: vi.fn(async () => {}) }));
vi.mock("~/hiring/lib/interview-notifications", () => ({ notifyInterviewAssigned: vi.fn(async () => {}) }));
vi.mock("~/hiring/lib/interview-meet", () => ({ syncInterviewMeetAttendees: vi.fn(async () => {}) }));

import { prisma } from "~/lib/db.server";
import {
  assignInterviewers,
  availabilityByInterview,
  computeAvailableSlots,
  explainAvailableSlots,
} from "~/hiring/lib/scheduling";
import { makeUser } from "~/lib/__tests__/integration-fixtures.calendar";

const NOW = new Date("2026-11-03T12:00:00Z");
// Monday 2026-11-09 in New York (EST, UTC-5): 9:00 local is 14:00Z.
const nine = (minutesAfter = 0) => new Date(Date.UTC(2026, 10, 9, 14, minutesAfter));
const SLOT_MIN = 30;
const slot = (minutesAfter = 0) => [nine(minutesAfter), nine(minutesAfter + SLOT_MIN)] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function makeRound(opts: { engInterviewers: number; designInterviewers: number; rooms?: number }) {
  const cycle = await prisma.applicationCycle.create({ data: { name: "Fall hiring" } });
  const eng = await prisma.domain.create({ data: { name: "Engineering", code: "eng", displayName: "Engineering" } });
  const design = await prisma.domain.create({ data: { name: "Design", code: "design", displayName: "Design" } });
  const rooms = await Promise.all(
    Array.from({ length: opts.rooms ?? 0 }, (_, i) => prisma.room.create({ data: { name: `Room ${i + 1}` } })),
  );
  await prisma.interviewConfig.create({
    data: {
      applicationCycleId: cycle.id,
      slotDurationMinutes: SLOT_MIN,
      bufferMinutes: 15,
      dayStartHour: 9,
      dayEndHour: 12,
      interviewStartDate: new Date("2026-11-09T05:00:00Z"),
      interviewEndDate: new Date("2026-11-09T05:00:00Z"),
      timezone: "America/New_York",
      bookingNoticeHours: 12,
      rooms: { connect: rooms.map((r) => ({ id: r.id })) },
    },
  });
  const roster = async (domainId: string, n: number, first: string) =>
    Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const user = await makeUser(`${first}${i}`, "Interviewer");
        return prisma.cycleInterviewer.create({ data: { userId: user.id, applicationCycleId: cycle.id, domainId } });
      }),
    );
  const engInterviewers = await roster(eng.id, opts.engInterviewers, "Eng");
  const designInterviewers = await roster(design.id, opts.designInterviewers, "Des");
  return { cycle, eng, design, rooms, engInterviewers, designInterviewers };
}

async function makeApplicant(cycleId: string, domainId: string, name: string) {
  const user = await makeUser(name, "Applicant");
  const application = await prisma.application.create({ data: { userId: user.id, applicationCycleId: cycleId, answers: {} } });
  return prisma.domainApplication.create({ data: { applicationId: application.id, domainId, answers: {} } });
}

const book = (
  r: Awaited<ReturnType<typeof makeRound>>,
  domainApplicationId: string,
  [start, end]: readonly [Date, Date],
  mode: "online" | "in-person" = "online",
) => assignInterviewers(r.cycle.id, "interviews", domainApplicationId, [r.eng.id], start, end, undefined, mode);

const scheduled = () => prisma.interview.findMany({ where: { status: "Scheduled" }, include: { assignments: true } });

describe("racing for one interviewer slot", () => {
  it("with a single in-domain and cross-domain interviewer, exactly one applicant gets the slot", async () => {
    const r = await makeRound({ engInterviewers: 1, designInterviewers: 1 });
    const a = await makeApplicant(r.cycle.id, r.eng.id, "Ada");
    const b = await makeApplicant(r.cycle.id, r.eng.id, "Grace");
    const results = await Promise.allSettled([book(r, a.id, slot()), book(r, b.id, slot())]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
    const interviews = await scheduled();
    expect(interviews).toHaveLength(1);
    expect(interviews[0].assignments.map((x) => x.role).sort()).toEqual(["CrossDomain", "InDomain"]);
    expect(await prisma.interview.count()).toBe(1);
  });

  it("with two of each, sequential bookings use four different interviewers and a third applicant is refused", async () => {
    const r = await makeRound({ engInterviewers: 2, designInterviewers: 2 });
    const [a, b, c] = await Promise.all(["Ada", "Grace", "Katherine"].map((n) => makeApplicant(r.cycle.id, r.eng.id, n)));
    await book(r, a.id, slot());
    await book(r, b.id, slot());
    await expect(book(r, c.id, slot())).rejects.toThrow(/available/);
    const interviews = await scheduled();
    expect(interviews).toHaveLength(2);
    const interviewerIds = interviews.flatMap((i) => i.assignments.map((x) => x.cycleInterviewerId));
    expect(new Set(interviewerIds).size).toBe(4);
  });

  it("three applicants racing for a slot with room for two fill both places without double-booking", async () => {
    const r = await makeRound({ engInterviewers: 2, designInterviewers: 2 });
    const people = await Promise.all(["Ada", "Grace", "Katherine"].map((n) => makeApplicant(r.cycle.id, r.eng.id, n)));
    const results = await Promise.allSettled(people.map((p) => book(r, p.id, slot())));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    const interviews = await scheduled();
    expect(interviews).toHaveLength(2);
    expect(interviews.every((i) => i.assignments.length === 2)).toBe(true);
    const interviewerIds = interviews.flatMap((i) => i.assignments.map((x) => x.cycleInterviewerId));
    expect(new Set(interviewerIds).size).toBe(interviewerIds.length);
  });

  it("a losing booking leaves nothing behind", async () => {
    const r = await makeRound({ engInterviewers: 1, designInterviewers: 1 });
    const a = await makeApplicant(r.cycle.id, r.eng.id, "Ada");
    const b = await makeApplicant(r.cycle.id, r.eng.id, "Grace");
    await book(r, a.id, slot());
    await expect(book(r, b.id, slot())).rejects.toThrow(/available/);
    expect(await prisma.interview.count({ where: { domainApplicationId: b.id } })).toBe(0);
    expect(await prisma.interviewAssignment.count()).toBe(2);
  });

  it("the buffer after a booking blocks an adjacent slot but not one past it", async () => {
    const r = await makeRound({ engInterviewers: 1, designInterviewers: 1 });
    const [a, b, c] = await Promise.all(["Ada", "Grace", "Katherine"].map((n) => makeApplicant(r.cycle.id, r.eng.id, n)));
    await book(r, a.id, slot(0));
    await expect(book(r, b.id, slot(30))).rejects.toThrow(/available/);
    await expect(book(r, b.id, slot(44))).rejects.toThrow(/available/);
    await book(r, c.id, slot(45));
    expect(await scheduled()).toHaveLength(2);
  });

  it("an interview cancelled in the database frees its interviewers", async () => {
    const r = await makeRound({ engInterviewers: 1, designInterviewers: 1 });
    const a = await makeApplicant(r.cycle.id, r.eng.id, "Ada");
    const b = await makeApplicant(r.cycle.id, r.eng.id, "Grace");
    const first = await book(r, a.id, slot());
    await prisma.interview.update({ where: { id: first.id }, data: { status: "CancelledByAdmin" } });
    await book(r, b.id, slot());
    expect((await scheduled()).map((i) => i.domainApplicationId)).toEqual([b.id]);
  });
});

describe("one active interview per applicant", () => {
  it("two simultaneous bookings for the same applicant leave one scheduled interview", async () => {
    const r = await makeRound({ engInterviewers: 2, designInterviewers: 2 });
    const a = await makeApplicant(r.cycle.id, r.eng.id, "Ada");
    const results = await Promise.allSettled([book(r, a.id, slot(0)), book(r, a.id, slot(120))]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await scheduled()).toHaveLength(1);
    expect(await prisma.interviewAssignment.count()).toBe(2);
  });

  it("the partial unique index refuses a second Scheduled row but allows history", async () => {
    const r = await makeRound({ engInterviewers: 1, designInterviewers: 1 });
    const a = await makeApplicant(r.cycle.id, r.eng.id, "Ada");
    const row = (status: "Scheduled" | "CancelledByAdmin" | "Completed", minutes: number) => ({
      domainApplicationId: a.id,
      applicationCycleId: r.cycle.id,
      startTime: nine(minutes),
      endTime: nine(minutes + 30),
      status,
    });
    await prisma.interview.create({ data: row("Scheduled", 0) });
    await prisma.interview.create({ data: row("CancelledByAdmin", 60) });
    await prisma.interview.create({ data: row("Completed", 90) });
    await expect(prisma.interview.create({ data: row("Scheduled", 120) })).rejects.toMatchObject({ code: "P2002" });
  });

  it("after cancelling, the applicant can book again", async () => {
    const r = await makeRound({ engInterviewers: 1, designInterviewers: 1 });
    const a = await makeApplicant(r.cycle.id, r.eng.id, "Ada");
    const first = await book(r, a.id, slot(0));
    await prisma.interview.update({ where: { id: first.id }, data: { status: "CancelledByAdmin" } });
    await book(r, a.id, slot(120));
    expect(await prisma.interview.count({ where: { domainApplicationId: a.id } })).toBe(2);
    expect(await scheduled()).toHaveLength(1);
  });
});

describe("in-person booking holds a real room", () => {
  it("with one room, two applicants racing for the same slot leave one interview and one room booking", async () => {
    const r = await makeRound({ engInterviewers: 2, designInterviewers: 2, rooms: 1 });
    const a = await makeApplicant(r.cycle.id, r.eng.id, "Ada");
    const b = await makeApplicant(r.cycle.id, r.eng.id, "Grace");
    const results = await Promise.allSettled([book(r, a.id, slot(), "in-person"), book(r, b.id, slot(), "in-person")]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const interviews = await scheduled();
    expect(interviews).toHaveLength(1);
    expect(interviews[0].roomId).toBe(r.rooms[0].id);
    expect(interviews[0].roomBookingId).not.toBeNull();
    expect(await prisma.roomBooking.count()).toBe(1);
    expect(await prisma.interviewAssignment.count()).toBe(2);
  });

  it("falls to the second room when the first is taken", async () => {
    const r = await makeRound({ engInterviewers: 2, designInterviewers: 2, rooms: 2 });
    const a = await makeApplicant(r.cycle.id, r.eng.id, "Ada");
    const b = await makeApplicant(r.cycle.id, r.eng.id, "Grace");
    await book(r, a.id, slot(), "in-person");
    await book(r, b.id, slot(), "in-person");
    const rooms = (await scheduled()).map((i) => i.roomId);
    expect(new Set(rooms).size).toBe(2);
    expect(await prisma.roomBooking.count()).toBe(2);
  });
});

describe("availability queries", () => {
  it("offers slots only where an in-domain and a cross-domain interviewer are both free", async () => {
    const r = await makeRound({ engInterviewers: 1, designInterviewers: 1 });
    const slots = await computeAvailableSlots(r.cycle.id, "interviews", [r.eng.id]);
    expect(slots[0]).toEqual({ startTime: nine().toISOString(), endTime: nine(30).toISOString() });
    expect(slots.every((s) => new Date(s.endTime) <= nine(180))).toBe(true);
    expect(slots).toHaveLength(((180 - SLOT_MIN) / 15) + 1);
  });

  it("drops the booked slot and its buffer, and restores them when the interview is cancelled", async () => {
    const r = await makeRound({ engInterviewers: 1, designInterviewers: 1 });
    const a = await makeApplicant(r.cycle.id, r.eng.id, "Ada");
    const starts = async () => (await computeAvailableSlots(r.cycle.id, "interviews", [r.eng.id])).map((s) => s.startTime);
    const before = await starts();
    const interview = await book(r, a.id, slot(30));
    const during = await starts();
    const blocked = before.filter((s) => !during.includes(s));
    // 9:30-10:00 booked, 15 minute buffer each side: starts 9:00 (ends 9:30 touches 9:15 buffer) through 10:00.
    expect(blocked).toEqual([0, 15, 30, 45, 60].map((m) => nine(m).toISOString()));
    await prisma.interview.update({ where: { id: interview.id }, data: { status: "CancelledByAdmin" } });
    expect(await starts()).toEqual(before);
  });

  it("names why nothing is offered", async () => {
    const empty = await makeRound({ engInterviewers: 0, designInterviewers: 0 });
    expect((await explainAvailableSlots(empty.cycle.id, "interviews", [empty.eng.id])).blocker).toBe("no-interviewers");
    expect((await explainAvailableSlots(empty.cycle.id, "interviews", [empty.eng.id], "in-person")).blocker).toBe("no-rooms");
    expect((await explainAvailableSlots("missing", "interviews", [empty.eng.id])).blocker).toBe("no-config");
  });

  it("needs two different people", async () => {
    const r = await makeRound({ engInterviewers: 1, designInterviewers: 0 });
    expect((await explainAvailableSlots(r.cycle.id, "interviews", [r.eng.id])).blocker).toBe("one-interviewer");
  });

  it("reports each interviewer as booked or free at an interview's time", async () => {
    const r = await makeRound({ engInterviewers: 2, designInterviewers: 1 });
    const a = await makeApplicant(r.cycle.id, r.eng.id, "Ada");
    const interview = await book(r, a.id, slot(0));
    const map = await availabilityByInterview(r.cycle.id, "interviews", [{ id: interview.id, startTime: nine(0), endTime: nine(30) }]);
    const byUser = map.get(interview.id)!;
    const all = [...r.engInterviewers, ...r.designInterviewers];
    const booked = new Set(interview.assignments.map((x) => x.cycleInterviewerId));
    for (const ci of all) expect(byUser[ci.userId]).toBe(booked.has(ci.id) ? "booked" : "free");
    expect(Object.values(byUser).filter((v) => v === "booked")).toHaveLength(2);
  });
});
