import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn(async () => false) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(false) }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loader } from "~/hiring/routes/applications";

const mockPrisma = prisma as unknown as Record<string, any>;

const CYCLE_ID = "cycle-1";
const APPLICATION_ID = "app-1";
const DOMAIN_ID = "domain-design";
const DA_ID = "da-1";

function makeRequest(query = "") {
  return new Request(`http://localhost/hiring/applications${query}`);
}

function callLoader(query = "") {
  return loader({ request: makeRequest(query), params: {}, context: {} } as any);
}

function baseDomainApp(overrides: Partial<{ user: any }> = {}) {
  return {
    id: DA_ID,
    domainId: DOMAIN_ID,
    domain: { displayName: "Design" },
    application: {
      id: APPLICATION_ID,
      user: overrides.user ?? {
        firstName: "Ada",
        lastName: "Lovelace",
        daliEmail: "ada@dali.dartmouth.edu",
        dartmouthEmail: "ada@dartmouth.edu",
      },
      statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2026-01-01") }],
    },
    _count: { reviews: 0 },
    closureReason: null,
    decisions: [],
    interviews: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "viewer-1", type: "user" } } as any);
  vi.mocked(getUserRoles).mockResolvedValue({
    isCore: true,
    isAdmin: false,
    isDomainLead: false,
    isInterviewer: false,
  } as any);

  mockPrisma.cycleReviewer = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.cycleInterviewer = { findFirst: vi.fn().mockResolvedValue(null) };
  mockPrisma.applicationCycle = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: CYCLE_ID,
        name: "Fall Cycle",
        createdAt: new Date("2026-01-01"),
        applicants: "Students",
        anonymizeReview: true,
        statusUpdates: [{ newStatus: "Reviewing" }],
      },
    ]),
  };
  mockPrisma.domainApplicationCycle = { findMany: vi.fn().mockResolvedValue([{ domainId: DOMAIN_ID }]) };
  mockPrisma.domain = { findMany: vi.fn().mockResolvedValue([{ id: DOMAIN_ID, displayName: "Design" }]) };
  mockPrisma.decision = { findMany: vi.fn().mockResolvedValue([]) };
  // application.findMany serves both the anon label map and the returning-
  // applicant lookup; neither test asserts on the latter, so one shape does.
  mockPrisma.application = { findMany: vi.fn().mockResolvedValue([{ id: APPLICATION_ID }]) };
  mockPrisma.mailMessageIndex = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.educationApplication = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.hiringEventAttendance = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.hiringEvent = { findMany: vi.fn().mockResolvedValue([]) };

  // domainApplication.findMany is called twice with different `where` shapes:
  // once scoped to visible domains (builds the rows), once unscoped per
  // applicationId (the full-application blind check).
  mockPrisma.domainApplication = {
    findMany: vi.fn().mockImplementation(({ where }: any) => {
      if (where.domainId) return Promise.resolve([baseDomainApp()]);
      return Promise.resolve([{ id: DA_ID, applicationId: APPLICATION_ID }]);
    }),
  };
});

describe("applications.tsx loader — blind review", () => {
  it("blinds the row's name and email when the cycle anonymizes review and nothing is released", async () => {
    const result: any = await callLoader();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe("Applicant 1");
    expect(result.rows[0].email).toBeNull();
  });

  it("shows the real name and email once the domain's decision is released", async () => {
    mockPrisma.decision.findMany.mockResolvedValue([{ domainApplicationId: DA_ID }]);
    const result: any = await callLoader();
    expect(result.rows[0].name).toBe("Ada Lovelace");
    expect(result.rows[0].email).toBe("ada@dali.dartmouth.edu");
  });

  it("does not blind when the cycle has anonymizeReview off", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      {
        id: CYCLE_ID,
        name: "Fall Cycle",
        createdAt: new Date("2026-01-01"),
        applicants: "Students",
        anonymizeReview: false,
        statusUpdates: [{ newStatus: "Reviewing" }],
      },
    ]);
    const result: any = await callLoader();
    expect(result.rows[0].name).toBe("Ada Lovelace");
  });
});

describe("applications.tsx loader — attendedEvent engagement signal", () => {
  function mockDomainAppsWithUserId(userId: string) {
    mockPrisma.domainApplication.findMany.mockImplementation(({ where }: any) => {
      if (where.domainId) {
        return Promise.resolve([
          baseDomainApp({
            user: {
              id: userId,
              firstName: "Ada",
              lastName: "Lovelace",
              daliEmail: "ada@dali.dartmouth.edu",
              dartmouthEmail: "ada@dartmouth.edu",
            },
          }),
        ]);
      }
      return Promise.resolve([{ id: DA_ID, applicationId: APPLICATION_ID }]);
    });
  }

  it("skips the attendance lookup and marks every row unattended when the flag is off", async () => {
    mockDomainAppsWithUserId("ada-user");

    const result: any = await callLoader();

    expect(mockPrisma.hiringEventAttendance.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.hiringEvent.findMany).not.toHaveBeenCalled();
    expect(result.rows[0].attendedEvent).toBe(false);
    expect(result.eventOptions).toEqual([]);
  });

  it("queries attendance scoped to the selected cycle and marks matching rows when the flag is on", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    mockPrisma.hiringEventAttendance.findMany.mockResolvedValue([
      { userId: "ada-user", eventId: "ev-1" },
      { userId: "ada-user", eventId: "ev-2" },
    ]);
    mockPrisma.hiringEvent.findMany.mockResolvedValue([
      { id: "ev-1", title: "Help hour", startsAt: new Date("2026-10-14T20:00:00Z") },
      { id: "ev-2", title: "Social", startsAt: new Date("2026-10-16T22:00:00Z") },
    ]);
    mockDomainAppsWithUserId("ada-user");

    const result: any = await callLoader();

    expect(mockPrisma.hiringEventAttendance.findMany).toHaveBeenCalledWith({
      where: { userId: { in: ["ada-user"] }, event: { applicationCycleId: CYCLE_ID } },
      select: { userId: true, eventId: true },
    });
    expect(mockPrisma.hiringEvent.findMany).toHaveBeenCalledWith({
      where: { applicationCycleId: CYCLE_ID },
      orderBy: { startsAt: "asc" },
      select: { id: true, title: true, startsAt: true },
    });
    expect(result.rows[0].attendedEvent).toBe(true);
    expect(result.rows[0].attendedEventIds).toEqual(["ev-1", "ev-2"]);
    expect(result.eventOptions).toEqual([
      { id: "ev-1", title: "Help hour", startsAt: "2026-10-14T20:00:00.000Z" },
      { id: "ev-2", title: "Social", startsAt: "2026-10-16T22:00:00.000Z" },
    ]);
  });

  it("does not mark a row attended when its userId isn't in the attendance result", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    mockPrisma.hiringEventAttendance.findMany.mockResolvedValue([{ userId: "someone-else", eventId: "ev-1" }]);
    mockDomainAppsWithUserId("ada-user");

    const result: any = await callLoader();

    expect(result.rows[0].attendedEvent).toBe(false);
    expect(result.rows[0].attendedEventIds).toEqual([]);
  });
});

describe("applications.tsx loader — reviewer and interviewer columns", () => {
  const person = (firstName: string, lastName: string) => ({ firstName, lastName, daliEmail: null });

  function useCycleStatus(newStatus: string) {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      {
        id: CYCLE_ID,
        name: "Fall Cycle",
        createdAt: new Date("2026-01-01"),
        applicants: "Students",
        anonymizeReview: false,
        statusUpdates: [{ newStatus }],
      },
    ]);
  }

  function rowsSelect() {
    const call = mockPrisma.domainApplication.findMany.mock.calls.find(([arg]: any) => arg.where.domainId);
    return call[0].select;
  }

  it("names the assigned reviewers and active interviewers while the cycle is under review", async () => {
    useCycleStatus("UnderReview");
    mockPrisma.domainApplication.findMany.mockImplementation(({ where }: any) => {
      if (!where.domainId) return Promise.resolve([{ id: DA_ID, applicationId: APPLICATION_ID }]);
      return Promise.resolve([
        {
          ...baseDomainApp(),
          reviews: [
            { cycleReviewer: { user: person("Rae", "One") } },
            { cycleReviewer: { user: person("Sam", "Two") } },
          ],
          interviews: [
            {
              status: "Completed",
              assignments: [
                { cycleInterviewer: { user: person("Ivy", "Three") } },
                { cycleInterviewer: { user: person("Rae", "One") } },
              ],
            },
            { status: "CancelledByApplicant", assignments: [{ cycleInterviewer: { user: person("Old", "Slot") } }] },
          ],
        },
      ]);
    });

    const result: any = await callLoader();

    expect(result.selectedCycleStatus).toBe("UnderReview");
    expect(result.rows[0].reviewers).toBe("Rae One, Sam Two");
    expect(result.rows[0].interviewers).toBe("Ivy Three, Rae One");
    expect(rowsSelect().reviews).toBeDefined();
    expect(rowsSelect().interviews.include.assignments.where).toEqual({ status: "Active" });
  });

  it("leaves both columns empty when nobody is assigned yet", async () => {
    useCycleStatus("UnderReview");
    mockPrisma.domainApplication.findMany.mockImplementation(({ where }: any) => {
      if (!where.domainId) return Promise.resolve([{ id: DA_ID, applicationId: APPLICATION_ID }]);
      return Promise.resolve([{ ...baseDomainApp(), reviews: [], interviews: [] }]);
    });

    const result: any = await callLoader();

    expect(result.rows[0].reviewers).toBeNull();
    expect(result.rows[0].interviewers).toBeNull();
  });

  it("skips the assignee lookups outside of review", async () => {
    useCycleStatus("Open");

    const result: any = await callLoader();

    expect(rowsSelect().reviews).toBeUndefined();
    expect(rowsSelect().interviews?.include).toBeUndefined();
    expect(result.rows[0].reviewers).toBeNull();
    expect(result.rows[0].interviewers).toBeNull();
  });
});
