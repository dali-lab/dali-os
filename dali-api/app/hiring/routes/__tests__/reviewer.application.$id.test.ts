import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { loader } from "~/hiring/routes/reviewer.application.$id";

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
    challengeVersion: {
      id: `cv-${id}`,
      domainId,
      questions: [{ key: `q-${domainId}`, data: { label: `Q for ${domainId}` } }],
      domain: { id: domainId, name: domainId },
      challenge: { id: `challenge-${domainId}`, name: `Challenge ${domainId}` },
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
    generalChallengeVersion: {
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
});

describe("reviewer.application.$id loader — domain scoping", () => {
  it("returns only the reviewer's domain DA for a multi-domain applicant (one domain)", async () => {
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      { id: DESIGN_REVIEWER_ID, domainId: DESIGN_DOMAIN_ID },
    ]);
    // The loader filters in the Prisma where clause; the mock should honor it
    // by returning DAs that match the reviewer's domain ids.
    mockPrisma.domainApplication.findMany.mockImplementation(({ where }: any) => {
      const allowed: string[] = where.challengeVersion.domainId.in;
      const all = [
        makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
        makeDA(WEB_DA_ID, WEB_DOMAIN_ID),
        makeDA(VIDEO_DA_ID, VIDEO_DOMAIN_ID),
      ];
      return Promise.resolve(all.filter((da) => allowed.includes(da.challengeVersion.domainId)));
    });

    const result: any = await callLoader();

    expect(result.application.domainApplications).toHaveLength(1);
    expect(result.application.domainApplications[0].id).toBe(DESIGN_DA_ID);
    expect(result.application.domainApplications[0].challengeVersion.domainId).toBe(DESIGN_DOMAIN_ID);

    // Confirm the loader is asking Prisma to filter by the reviewer's domain ids
    // — not relying on app-side filtering after fetching everything.
    const findManyArgs = mockPrisma.domainApplication.findMany.mock.calls[0][0];
    expect(findManyArgs.where.applicationId).toBe(APPLICATION_ID);
    expect(findManyArgs.where.challengeVersion.domainId.in).toEqual([DESIGN_DOMAIN_ID]);
  });

  it("returns multiple DAs when the reviewer is assigned to multiple matching domains", async () => {
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      { id: DESIGN_REVIEWER_ID, domainId: DESIGN_DOMAIN_ID },
      { id: WEB_REVIEWER_ID, domainId: WEB_DOMAIN_ID },
    ]);
    mockPrisma.domainApplication.findMany.mockImplementation(({ where }: any) => {
      const allowed: string[] = where.challengeVersion.domainId.in;
      const all = [
        makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
        makeDA(WEB_DA_ID, WEB_DOMAIN_ID),
        makeDA(VIDEO_DA_ID, VIDEO_DOMAIN_ID),
      ];
      return Promise.resolve(all.filter((da) => allowed.includes(da.challengeVersion.domainId)));
    });

    const result: any = await callLoader();

    const ids = result.application.domainApplications.map((da: any) => da.id).sort();
    expect(ids).toEqual([DESIGN_DA_ID, WEB_DA_ID].sort());
    expect(
      result.application.domainApplications.some(
        (da: any) => da.challengeVersion.domainId === VIDEO_DOMAIN_ID,
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
      const allowed: string[] = where.challengeVersion.domainId.in;
      const all = [
        makeDA(DESIGN_DA_ID, DESIGN_DOMAIN_ID),
        makeDA(WEB_DA_ID, WEB_DOMAIN_ID),
      ];
      return Promise.resolve(all.filter((da) => allowed.includes(da.challengeVersion.domainId)));
    });

    const result: any = await callLoader();

    expect(result.application.domainApplications).toHaveLength(0);
    const findManyArgs = mockPrisma.domainApplication.findMany.mock.calls[0][0];
    expect(findManyArgs.where.challengeVersion.domainId.in).toEqual([]);
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
    expect(thrown.headers.get("location")).toBe("/login");
    // Domain scoping queries should not run if access is denied.
    expect(mockPrisma.domainApplication.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.cycleReviewer.findMany).not.toHaveBeenCalled();
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
