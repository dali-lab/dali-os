import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { getEducationEngagement, getEducationProfile } from "~/education/lib/engagement.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

const NOW = new Date("2026-01-15T00:00:00Z");

function pastSession(id: string, daysAgo: number) {
  return { id, datetime: new Date(NOW.getTime() - daysAgo * 86_400_000), endsAt: null };
}
function futureSession(id: string, daysAhead: number) {
  return { id, datetime: new Date(NOW.getTime() + daysAhead * 86_400_000), endsAt: null };
}

const PAST_SESSIONS = [pastSession("s1", 3), pastSession("s2", 2), pastSession("s3", 1)];
const FUTURE_SESSIONS = [
  futureSession("s4", 1),
  futureSession("s5", 2),
  futureSession("s6", 3),
  futureSession("s7", 4),
  futureSession("s8", 5),
  futureSession("s9", 6),
  futureSession("s10", 7),
];

const APPROVED_APPLICATION = {
  status: "Approved",
  offering: {
    id: "off-1",
    title: "Intro to DALI",
    type: "Miniseries",
    startsAt: new Date("2026-01-01T00:00:00Z"),
    endsAt: new Date("2026-03-01T00:00:00Z"),
    sessions: [...PAST_SESSIONS, ...FUTURE_SESSIONS],
  },
  attendances: [
    { sessionId: "s1", status: "Present" },
    { sessionId: "s2", status: "Present" },
    // s3 (past) left unmarked.
    { sessionId: "s4", status: "Present" }, // future — must not count.
  ],
  certificate: null,
  note: { feedback: "Great work", internalNote: "Hiring note" },
};

beforeEach(() => {
  vi.resetAllMocks();
  // getEducationProfile calls getEducationEngagement without a `now` override,
  // so pin the clock for that path to keep the past/future split deterministic.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getEducationEngagement", () => {
  it("counts present/excused only against sessions already held", async () => {
    mockPrisma.educationApplication.findMany.mockResolvedValue([APPROVED_APPLICATION]);

    const entries = await getEducationEngagement("user-1", NOW);

    expect(entries).toHaveLength(1);
    expect(entries[0].attendance).toEqual({ present: 2, excused: 0, held: 3, total: 10 });
  });
});

describe("getEducationProfile", () => {
  it("strips internalNote and feedback from the attended entries", async () => {
    mockPrisma.educationApplication.findMany.mockResolvedValue([APPROVED_APPLICATION]);
    mockPrisma.instructorAssignment.findMany.mockResolvedValue([]);
    mockPrisma.cECredit.findMany.mockResolvedValue([]);

    const profile = await getEducationProfile("user-1");

    expect(profile.attended).toHaveLength(1);
    expect(profile.attended[0]).not.toHaveProperty("internalNote");
    expect(profile.attended[0]).not.toHaveProperty("feedback");
    expect(profile.attended[0].attendance).toEqual({
      present: 2,
      excused: 0,
      held: 3,
      total: 10,
    });
  });
});
