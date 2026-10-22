import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/hiring/lib/application-view-audit.server", () => ({ logApplicationView: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock("~/hiring/lib/email-engagement.server", () => ({
  getApplicantEmailEngagement: vi.fn(async () => null),
}));
vi.mock("~/hiring/lib/hiring-events.server", () => ({
  getHiringEventEngagement: vi.fn(async () => []),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getHiringEventEngagement } from "~/hiring/lib/hiring-events.server";
import { logAuditEvent } from "~/lib/audit";
import { logApplicationView } from "~/hiring/lib/application-view-audit.server";
import { loader, action } from "~/hiring/routes/reviewer.application.$id";

const mockPrisma = prisma as unknown as Record<string, any>;

const USER_ID = "user-1";
const APPLICATION_ID = "app-1";
const CYCLE_ID = "cycle-1";
const DESIGN_DOMAIN_ID = "domain-design";
const WEB_DOMAIN_ID = "domain-web";
const VIDEO_DOMAIN_ID = "domain-video";

const DESIGN_DA_ID = "da-design";
const WEB_DA_ID = "da-web";
const VIDEO_DA_ID = "da-video";

const DESIGN_REVIEWER_ID = "cr-design";
const WEB_REVIEWER_ID = "cr-web";

function makeRequest() {
  return new Request(`http://localhost/hiring/reviewer/application/${APPLICATION_ID}`);
}

function callLoader() {
  return loader({
    request: makeRequest(),
    params: { id: APPLICATION_ID },
    context: {},
  } as any);
}

function makeDA(id: string, domainId: string) {
  return {
    id,
    applicationId: APPLICATION_ID,
    answers: {},
    domainId,
    domain: { id: domainId, name: domainId },
    challengeFormVersion: {
      questions: [{ key: `q-${domainId}`, data: { label: `Q for ${domainId}` } }],
      intro: null,
      form: { name: "Challenge" },
    },
  };
}

function setupApplicationBase() {
  mockPrisma.application = mockPrisma.application ?? {};
  mockPrisma.application.findUniqueOrThrow = vi.fn().mockResolvedValue({
    id: APPLICATION_ID,
    applicationCycleId: CYCLE_ID,
    answers: {},
    user: { id: "u-1", firstName: "Ada", lastName: "Lovelace" },
    applicationFormVersion: {
      id: "gcv-1",
      questions: [{ key: "g1", data: { label: "G1" } }],
    },
    applicationCycle: {
      id: CYCLE_ID,
      name: "Test Cycle",
      statusUpdates: [{ newStatus: "Reviewing" }],
      generalRubricVersion: { criteria: [], rubric: { id: "r-1", name: "General" } },
      domains: [],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupApplicationBase();
  mockPrisma.cycleReviewer = { findMany: vi.fn() };
  mockPrisma.user.findUniqueOrThrow = vi.fn().mockResolvedValue({
    id: USER_ID,
    firstName: "Rev",
    lastName: "Iewer",
    email: "rev@x.com",
  });
  mockPrisma.domainApplication = { findMany: vi.fn() };
  mockPrisma.applicationReview = {
    findFirst: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockImplementation(({ create }: any) =>
      Promise.resolve({ id: "review-new", ...create }),
    ),
  };

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "rev@x.com", type: "user" },
  } as any);
  vi.mocked(hasCycleAccess).mockResolvedValue(true);
  vi.mocked(getUserRoles).mockResolvedValue({
    isCore: false,
    isAdmin: false,
    isDomainLead: false,
    isInterviewer: false,
  } as any);
});

describe("reviewer.application.$id loader — domain scoping", () => {
  it("returns only the reviewer's domain DA for a multi-domain applicant (one domain)", async () => {
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      { id: DESIGN_REVIEWER_ID, domainId: DESIGN_DOMAIN_ID },
    ]);
    // The loader filters in the Prisma where clause; the mock should honor it
    // by returning DAs that match the reviewer's domain ids.
    mockPrisma.domainApplication.findMany.mockImplementation(({ where }: any) => {
      const allowed: string[] = where.domainId?.in ?? [];
      const all = [
        makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
        makeDA(WEB_DA_ID, WEB_DOMAIN_ID),
        makeDA(VIDEO_DA_ID, VIDEO_DOMAIN_ID),
      ];
      return Promise.resolve(all.filter((da) => allowed.includes(da.domainId)));
    });

    const result: any = await callLoader();

    expect(result.application.domainApplications).toHaveLength(1);
    expect(result.application.domainApplications[0].id).toBe(DESIGN_DA_ID);
    expect(result.application.domainApplications[0].domainId).toBe(DESIGN_DOMAIN_ID);

    // Confirm the loader is asking Prisma to filter by the reviewer's domain ids
    // — not relying on app-side filtering after fetching everything.
    const findManyArgs = mockPrisma.domainApplication.findMany.mock.calls[0][0];
    expect(findManyArgs.where.applicationId).toBe(APPLICATION_ID);
    expect(findManyArgs.where.domainId.in).toEqual([DESIGN_DOMAIN_ID]);
  });

  it("returns multiple DAs when the reviewer is assigned to multiple matching domains", async () => {
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      { id: DESIGN_REVIEWER_ID, domainId: DESIGN_DOMAIN_ID },
      { id: WEB_REVIEWER_ID, domainId: WEB_DOMAIN_ID },
    ]);
    mockPrisma.domainApplication.findMany.mockImplementation(({ where }: any) => {
      const allowed: string[] = where.domainId?.in ?? [];
      const all = [
        makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
        makeDA(WEB_DA_ID, WEB_DOMAIN_ID),
        makeDA(VIDEO_DA_ID, VIDEO_DOMAIN_ID),
      ];
      return Promise.resolve(all.filter((da) => allowed.includes(da.domainId)));
    });

    const result: any = await callLoader();

    const ids = result.application.domainApplications.map((da: any) => da.id).sort();
    expect(ids).toEqual([DESIGN_DA_ID, WEB_DA_ID].sort());
    expect(
      result.application.domainApplications.some(
        (da: any) => da.domainId === VIDEO_DOMAIN_ID,
      ),
    ).toBe(false);
  });

  it("returns the single DA unchanged for a single-domain applicant", async () => {
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      { id: DESIGN_REVIEWER_ID, domainId: DESIGN_DOMAIN_ID },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
    ]);

    const result: any = await callLoader();

    expect(result.application.domainApplications).toHaveLength(1);
    expect(result.application.domainApplications[0].id).toBe(DESIGN_DA_ID);
  });

  it("returns zero DAs when the user has no cycleReviewer row in this cycle", async () => {
    // e.g. an admin who lands on /hiring/reviewer/application/:id without
    // being assigned as a reviewer for this cycle. The filter `{ in: [] }`
    // yields zero DAs. This test locks in the current behavior; flip if
    // product wants admins to fall through to "show all DAs" instead.
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([]);
    mockPrisma.domainApplication.findMany.mockImplementation(({ where }: any) => {
      const allowed: string[] = where.domainId?.in ?? [];
      const all = [
        makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
        makeDA(WEB_DA_ID, WEB_DOMAIN_ID),
      ];
      return Promise.resolve(all.filter((da) => allowed.includes(da.domainId)));
    });

    const result: any = await callLoader();

    expect(result.application.domainApplications).toHaveLength(0);
    const findManyArgs = mockPrisma.domainApplication.findMany.mock.calls[0][0];
    expect(findManyArgs.where.domainId.in).toEqual([]);
  });

  it("redirects to /login when hasCycleAccess denies", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(false);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);

    let thrown: any;
    try {
      await callLoader();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(302);
    expect(thrown.headers.get("location")).toBe(
      `/login?next=${encodeURIComponent(`/hiring/reviewer/application/${APPLICATION_ID}`)}`,
    );
    // Domain scoping queries should not run if access is denied.
    expect(mockPrisma.domainApplication.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.cycleReviewer.findMany).not.toHaveBeenCalled();
    expect(logApplicationView).not.toHaveBeenCalled();
  });
});

describe("reviewer.application.$id loader — auto-create review row", () => {
  it("does not call upsert when an ApplicationReview already exists", async () => {
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      { id: DESIGN_REVIEWER_ID, domainId: DESIGN_DOMAIN_ID },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
    ]);
    mockPrisma.applicationReview.findFirst.mockResolvedValue({
      id: "review-existing",
      scores: { c1: 4 },
      overallRecommendation: "Hire",
      annotations: [],
      submittedAt: null,
      updatedAt: new Date("2026-04-01T00:00:00Z"),
    });

    const result: any = await callLoader();

    expect(mockPrisma.applicationReview.upsert).not.toHaveBeenCalled();
    expect(result.existingReview.id).toBe("review-existing");
  });

  it("upserts a review row keyed to the reviewer's matching DA when none exists", async () => {
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      { id: DESIGN_REVIEWER_ID, domainId: DESIGN_DOMAIN_ID },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
    ]);
    mockPrisma.applicationReview.findFirst.mockResolvedValue(null);

    await callLoader();

    expect(mockPrisma.applicationReview.upsert).toHaveBeenCalledTimes(1);
    const args = mockPrisma.applicationReview.upsert.mock.calls[0][0];
    expect(args.where.cycleReviewerId_domainApplicationId).toEqual({
      cycleReviewerId: DESIGN_REVIEWER_ID,
      domainApplicationId: DESIGN_DA_ID,
    });
    expect(args.create).toEqual({
      cycleReviewerId: DESIGN_REVIEWER_ID,
      domainApplicationId: DESIGN_DA_ID,
    });
  });

  it("does not upsert when the user has no cycleReviewer row (no matching domain)", async () => {
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);
    mockPrisma.applicationReview.findFirst.mockResolvedValue(null);

    await callLoader();

    expect(mockPrisma.applicationReview.upsert).not.toHaveBeenCalled();
  });
});

describe("reviewer.application.$id loader — prior applications", () => {
  function setApplicationBaseAnonymize(anonymizeReview: boolean) {
    mockPrisma.application.findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: APPLICATION_ID,
      applicationCycleId: CYCLE_ID,
      answers: {},
      user: { id: "u-1", firstName: "Ada", lastName: "Lovelace" },
      applicationFormVersion: {
        id: "gcv-1",
        questions: [{ key: "g1", data: { label: "G1" } }],
      },
      applicationCycle: {
        id: CYCLE_ID,
        name: "Test Cycle",
        anonymizeReview,
        statusUpdates: [{ newStatus: "Reviewing" }],
        generalRubricVersion: { criteria: [], rubric: { id: "r-1", name: "General" } },
        domains: [],
      },
    });
  }

  function mockHistoryQuery() {
    mockPrisma.application.findMany = vi.fn().mockImplementation(({ where }: any) => {
      // anonLabelMapForCycle (inside reviewerBlindLabel) queries by cycle id;
      // listMyHiringApplications (inside listPriorApplications) queries by user id.
      if (where?.applicationCycleId) return Promise.resolve([{ id: APPLICATION_ID }]);
      if (where?.userId) {
        return Promise.resolve([
          {
            id: "prior-app-1",
            applicationType: "Standard",
            statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2025-01-01") }],
            applicationCycle: {
              id: "prior-cycle",
              name: "Prior Cycle",
              statusUpdates: [{ newStatus: "Completed" }],
            },
            domainApplications: [
              {
                id: "prior-da-1",
                domain: { name: "Design" },
                closureReason: null,
                application: {
                  statusUpdates: [
                    { newStatus: "Submitted", createdAt: new Date("2025-01-01") },
                  ],
                },
                decisions: [
                  { stage: "Released", type: "Accepted", createdAt: new Date("2025-02-01") },
                ],
                interviews: [],
                submittedAt: new Date("2025-01-01"),
              },
            ],
          },
        ]);
      }
      return Promise.resolve([]);
    });
  }

  it("nulls every prior domain status while the current applicant is blinded", async () => {
    setApplicationBaseAnonymize(true);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      { id: DESIGN_REVIEWER_ID, domainId: DESIGN_DOMAIN_ID },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
    ]);
    mockPrisma.decision = { findMany: vi.fn().mockResolvedValue([]) };
    mockHistoryQuery();

    const result: any = await callLoader();

    expect(result.blinded).toBe(true);
    expect(logApplicationView).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, applicationId: APPLICATION_ID, cycleId: CYCLE_ID, blinded: true }),
    );
    expect(result.priorApplications).toHaveLength(1);
    for (const prior of result.priorApplications) {
      for (const domain of prior.domains) {
        expect(domain.status).toBeNull();
      }
    }
  });

  it("keeps prior domain statuses when the current applicant is not blinded", async () => {
    setApplicationBaseAnonymize(false);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      { id: DESIGN_REVIEWER_ID, domainId: DESIGN_DOMAIN_ID },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
    ]);
    mockHistoryQuery();

    const result: any = await callLoader();

    expect(result.blinded).toBe(false);
    expect(logApplicationView).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: APPLICATION_ID, blinded: false }),
    );
    expect(result.priorApplications).toHaveLength(1);
    expect(result.priorApplications[0].domains[0].status).toBe("Accepted");
  });
});

describe("reviewer.application.$id loader — application events engagement", () => {
  beforeEach(() => {
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      { id: DESIGN_REVIEWER_ID, domainId: DESIGN_DOMAIN_ID },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
    ]);
  });

  it("defaults to an empty list and skips the lookup when the flag is off", async () => {
    const result: any = await callLoader();

    expect(getHiringEventEngagement).not.toHaveBeenCalled();
    expect(result.hiringEventEngagement).toEqual([]);
  });

  it("fetches the applicant's event attendance when the flag is on", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(getHiringEventEngagement).mockResolvedValue([
      {
        eventId: "evt-1",
        title: "Help hour",
        kind: "HelpHour",
        startsAt: new Date("2026-10-14T20:00:00.000Z"),
        endsAt: new Date("2026-10-14T21:00:00.000Z"),
        cycleId: CYCLE_ID,
        cycleName: "Test Cycle",
      },
    ] as never);

    const result: any = await callLoader();

    expect(getHiringEventEngagement).toHaveBeenCalledWith("u-1");
    expect(result.hiringEventEngagement).toHaveLength(1);
  });
});

describe("reviewer.application.$id action — save-review audit", () => {
  const EXISTING = {
    id: "review-1",
    scores: { craft: 4 },
    feedback: "private feedback",
    rejectionRationale: "",
    overallRecommendation: "Lean Hire",
    annotations: [],
    rubricVersionId: "rv-1",
    domainApplication: {
      domainId: DESIGN_DOMAIN_ID,
      application: { applicationCycleId: CYCLE_ID, applicationCycle: { hasChallenges: false } },
    },
  };

  function save(fields: { scores: unknown; overallRecommendation: string; annotations?: unknown }) {
    const body = new FormData();
    body.set("intent", "save-review");
    body.set("scores", JSON.stringify(fields.scores));
    body.set("overallRecommendation", fields.overallRecommendation);
    body.set("annotations", JSON.stringify(fields.annotations ?? []));
    return action({
      request: new Request("http://localhost/hiring/reviewer/application/app-1", { method: "POST", body }),
      params: { id: APPLICATION_ID },
      context: {},
    } as any);
  }

  beforeEach(() => {
    mockPrisma.applicationReview.findFirst = vi.fn().mockResolvedValue(EXISTING);
    mockPrisma.applicationReview.update = vi.fn().mockResolvedValue({});
    mockPrisma.applicationCycle = { findUnique: vi.fn().mockResolvedValue(null) };
  });

  it("logs the score and recommendation change against the review", async () => {
    await save({ scores: { craft: 8 }, overallRecommendation: "Hire" });

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "review.update",
        userId: USER_ID,
        targetId: "review-1",
        metadata: {
          cycleId: CYCLE_ID,
          applicationId: APPLICATION_ID,
          fields: ["scores", "overallRecommendation"],
          scores: { before: { craft: 4 }, after: { craft: 8 } },
          recommendation: { before: "Lean Hire", after: "Hire" },
        },
      }),
    );
  });

  it("logs nothing for an autosave that changes nothing", async () => {
    await save({ scores: { craft: 4 }, overallRecommendation: "Lean Hire" });
    expect(mockPrisma.applicationReview.update).toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("logs nothing when the reviewer has no review row to update", async () => {
    mockPrisma.applicationReview.findFirst = vi.fn().mockResolvedValue(null);
    await save({ scores: { craft: 8 }, overallRecommendation: "Hire" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
