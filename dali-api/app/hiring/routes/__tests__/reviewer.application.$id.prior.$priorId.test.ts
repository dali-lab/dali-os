import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { loader } from "~/hiring/routes/reviewer.application.$id.prior.$priorId";

const mockPrisma = prisma as unknown as Record<string, any>;

const REVIEWER_ID = "user-1";
const CURRENT_ID = "app-current";
const PRIOR_ID = "app-prior";
const CYCLE_ID = "cycle-1";
const APPLICANT_ID = "applicant-1";

function makeRequest() {
  return new Request(
    `http://localhost/hiring/reviewer/application/${CURRENT_ID}/prior/${PRIOR_ID}`,
  );
}

function callLoader() {
  return loader({
    request: makeRequest(),
    params: { id: CURRENT_ID, priorId: PRIOR_ID },
    context: {},
  } as any);
}

function makeCurrent(overrides: Partial<any> = {}) {
  return {
    id: CURRENT_ID,
    userId: APPLICANT_ID,
    applicationCycleId: CYCLE_ID,
    applicationCycle: { anonymizeReview: false },
    ...overrides,
  };
}

function makePrior(overrides: Partial<any> = {}) {
  return {
    id: PRIOR_ID,
    userId: APPLICANT_ID,
    answers: {},
    applicationType: "Standard",
    applicationFormVersion: { id: "gcv-1", questions: [] },
    applicationCycle: { name: "Spring 2025" },
    statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2025-01-10") }],
    domainApplications: [],
    user: {
      id: APPLICANT_ID,
      firstName: "Ada",
      lastName: "Lovelace",
      daliEmail: "ada@dali.dartmouth.edu",
    },
    ...overrides,
  };
}

function setupCurrentAndPrior(current: any, prior: any) {
  mockPrisma.application.findUnique.mockImplementation(({ where }: any) => {
    if (where.id === CURRENT_ID) return Promise.resolve(current);
    if (where.id === PRIOR_ID) return Promise.resolve(prior);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.application = {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  };
  mockPrisma.cycleReviewer = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.domainApplication = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.decision = { findMany: vi.fn().mockResolvedValue([]) };

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: REVIEWER_ID, email: "rev@x.com", type: "user" },
  } as any);
  vi.mocked(hasCycleAccess).mockResolvedValue(true);
});

describe("reviewer.application.$id.prior.$priorId loader", () => {
  it("404s when the prior application belongs to a different applicant", async () => {
    setupCurrentAndPrior(makeCurrent(), makePrior({ userId: "someone-else" }));

    let thrown: any;
    try {
      await callLoader();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(404);
  });

  it("404s when the prior id is the current application", async () => {
    setupCurrentAndPrior(makeCurrent(), makePrior({ id: CURRENT_ID }));

    let thrown: any;
    try {
      await callLoader();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(404);
  });

  it("404s when the prior application is still a draft", async () => {
    setupCurrentAndPrior(
      makeCurrent(),
      makePrior({ statusUpdates: [{ newStatus: "Draft", createdAt: new Date("2025-01-10") }] }),
    );

    let thrown: any;
    try {
      await callLoader();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(404);
  });

  it("redirects to login when hasCycleAccess denies", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(false);
    setupCurrentAndPrior(makeCurrent(), makePrior());

    let thrown: any;
    try {
      await callLoader();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(302);
  });

  it("blinds the applicant when anonymizeReview is on and no decision is released in the reviewer's domain", async () => {
    setupCurrentAndPrior(
      makeCurrent({ applicationCycle: { anonymizeReview: true } }),
      makePrior(),
    );
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ domainId: "domain-1" }]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([{ id: "da-1" }]);
    mockPrisma.decision.findMany.mockResolvedValue([]);
    mockPrisma.application.findMany.mockResolvedValue([{ id: CURRENT_ID }]);

    const result: any = await callLoader();

    expect(result.application.user.firstName).toMatch(/^Applicant/);
    expect(result.application.user.lastName).toBe("");
    expect(result.application.user.daliEmail).toBeNull();
    expect(result.blinded).toBe(true);
  });

  it("blinds a lead with no reviewer assignment while the current applicant is blinded on the detail pages", async () => {
    setupCurrentAndPrior(
      makeCurrent({ applicationCycle: { anonymizeReview: true } }),
      makePrior(),
    );
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([{ id: "da-1" }]);
    mockPrisma.decision.findMany.mockResolvedValue([]);
    mockPrisma.application.findMany.mockResolvedValue([{ id: CURRENT_ID }]);

    const result: any = await callLoader();

    expect(result.application.user.firstName).toMatch(/^Applicant/);
    expect(result.blinded).toBe(true);
  });

  it("shows the real name when not blinded", async () => {
    setupCurrentAndPrior(makeCurrent(), makePrior());

    const result: any = await callLoader();

    expect(result.application.user.firstName).toBe("Ada");
    expect(result.application.user.lastName).toBe("Lovelace");
    expect(result.blinded).toBe(false);
  });

  it("never includes reviews, decisions, or existingReview in the payload", async () => {
    setupCurrentAndPrior(makeCurrent(), makePrior());

    const result: any = await callLoader();

    expect(result).not.toHaveProperty("reviews");
    expect(result).not.toHaveProperty("decisions");
    expect(result).not.toHaveProperty("existingReview");
  });
});
