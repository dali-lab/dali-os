import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    educationOffering: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    educationSession: { findFirst: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
    instructorAssignment: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(), isCore: vi.fn() }));
vi.mock("~/lib/promotion-notify.server", () => ({ notifyAdminsOfPromotion: vi.fn() }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn() }));
vi.mock("~/lib/dartmouth-people", () => ({ peopleByNetId: vi.fn() }));
vi.mock("~/education/lib/access.server", () => ({
  manageableOfferingIds: vi.fn(),
  isOfferingManager: vi.fn(),
}));
vi.mock("~/education/lib/notifications.server", () => ({ notifyExternalInstructorInvite: vi.fn() }));
vi.mock("~/education/lib/application-form.server", () => ({ createOfferingApplicationForm: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { isCore, currentTerm } from "~/lib/roles";
import { isOfferingManager } from "~/education/lib/access.server";
import { runOfferingAction } from "~/education/lib/offerings.server";

const offering = vi.mocked(prisma.educationOffering);
const sessions = vi.mocked(prisma.educationSession);

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set("offeringId", "o1");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const createdTimes = () =>
  (sessions.createMany.mock.calls[0][0] as { data: { datetime: Date }[] }).data.map((d) =>
    d.datetime.toISOString(),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isOfferingManager).mockResolvedValue(true);
  vi.mocked(currentTerm).mockResolvedValue(null as never);
  sessions.findFirst.mockResolvedValue(null as never);
  sessions.findMany.mockResolvedValue([] as never);
  offering.create.mockResolvedValue({ id: "o2" } as never);
});

describe("generate-sessions interval mode", () => {
  it("keeps the time of day across the fall clock change", async () => {
    offering.findUnique.mockResolvedValue({ id: "o1", sessions: [] } as never);

    await runOfferingAction(
      form({
        intent: "generate-sessions",
        startDatetime: "2026-10-27T14:00",
        count: "3",
        intervalDays: "7",
      }),
      "u1",
    );

    expect(createdTimes()).toEqual([
      "2026-10-27T18:00:00.000Z", // 2:00 PM EDT
      "2026-11-03T19:00:00.000Z", // 2:00 PM EST
      "2026-11-10T19:00:00.000Z",
    ]);
  });
});

describe("duplicate-offering", () => {
  const source = (sessionDates: string[]) => ({
    id: "o1",
    sessions: sessionDates.map((datetime, i) => ({
      sequence: i + 1,
      title: null,
      location: null,
      datetime: new Date(datetime),
    })),
    type: "Workshop",
    title: "Intro",
    capacity: 10,
    requiresReview: false,
    calendarEmail: null,
    completionThreshold: null,
    completionMinSessions: null,
    registrationOpensAt: new Date("2026-09-01T16:00:00Z"), // Noon EDT
    registrationClosesAt: new Date("2026-09-08T16:00:00Z"),
    instructors: [],
  });

  it("keeps each session's time of day when a run moves across a clock change", async () => {
    offering.findUnique.mockResolvedValue(
      source(["2026-10-27T18:00:00Z", "2026-11-03T19:00:00Z"]) as never,
    );

    await runOfferingAction(
      form({ intent: "duplicate-offering", firstSessionDate: "2027-01-12T14:00" }),
      "u1",
    );

    const data = (offering.create.mock.calls[0][0] as {
      data: {
        registrationOpensAt: Date;
        sessions: { create: { datetime: Date }[] };
      };
    }).data;
    expect(data.sessions.create.map((s) => s.datetime.toISOString())).toEqual([
      "2027-01-12T19:00:00.000Z", // 2:00 PM EST
      "2027-01-19T19:00:00.000Z",
    ]);
    // The source window opened 56 days before its first session, at noon.
    expect(data.registrationOpensAt.toISOString()).toBe("2026-11-17T17:00:00.000Z");
  });

  it("copies dates unchanged when no new first session is given", async () => {
    offering.findUnique.mockResolvedValue(source(["2026-10-27T18:00:00Z"]) as never);

    await runOfferingAction(form({ intent: "duplicate-offering" }), "u1");

    const data = (offering.create.mock.calls[0][0] as {
      data: { sessions: { create: { datetime: Date }[] } };
    }).data;
    expect(data.sessions.create[0].datetime.toISOString()).toBe("2026-10-27T18:00:00.000Z");
  });
});
