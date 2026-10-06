import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requirePageSignedOrRedirect: vi.fn() }));
vi.mock("~/education/lib/engagement.server", () => ({ getEducationEngagement: vi.fn() }));
vi.mock("~/hiring/lib/prior-applications.server", () => ({ listPriorApplications: vi.fn() }));
vi.mock("~/hiring/lib/email-engagement.server", () => ({ getApplicantEmailEngagement: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { getEducationEngagement } from "~/education/lib/engagement.server";
import { listPriorApplications } from "~/hiring/lib/prior-applications.server";
import { getApplicantEmailEngagement } from "~/hiring/lib/email-engagement.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loader } from "~/hiring/routes/applications.$domainApplicationId";

const mockPrisma = prisma as unknown as Record<string, any>;

const DA_ID = "da-1";
const APPLICATION_ID = "app-1";
const CYCLE_ID = "cycle-1";

function baseDa(overrides: { anonymizeReview: boolean }) {
  return {
    id: DA_ID,
    domainId: "domain-1",
    answers: {},
    interviewPrepNote: null,
    domain: { id: "domain-1", name: "Design", displayName: "Design" },
    challengeFormVersion: null,
    application: {
      id: APPLICATION_ID,
      answers: {},
      applicationCycleId: CYCLE_ID,
      applicationFormVersion: null,
      applicationCycle: {
        name: "Fall Cycle",
        applicants: "Students",
        timeline: null,
        hasChallenges: false,
        anonymizeReview: overrides.anonymizeReview,
        generalRubricVersion: null,
        domains: [],
      },
      statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2026-01-01") }],
      user: { id: "u-1", firstName: "Ada", lastName: "Lovelace" },
    },
  };
}

function callLoader() {
  return loader({
    request: new Request(`http://localhost/hiring/applications/${DA_ID}`),
    params: { domainApplicationId: DA_ID },
    context: {},
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "viewer-1", type: "user" } } as any);
  vi.mocked(getUserRoles).mockResolvedValue({ isAdmin: true, isCore: true, isDomainLead: false } as any);
  vi.mocked(requirePageSignedOrRedirect).mockResolvedValue(null as never);
  vi.mocked(getEducationEngagement).mockResolvedValue([] as never);
  vi.mocked(listPriorApplications).mockResolvedValue([] as never);
  vi.mocked(getApplicantEmailEngagement).mockResolvedValue(null as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(false);

  mockPrisma.domainApplication = {
    findUnique: vi.fn().mockResolvedValue(baseDa({ anonymizeReview: true })),
    findMany: vi.fn().mockResolvedValue([{ id: DA_ID }]),
  };
  mockPrisma.domainLeadAssignment = { findFirst: vi.fn().mockResolvedValue(null) };
  mockPrisma.applicationReview = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.interview = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.decision = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.delibsSession = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.cycleReviewer = { findFirst: vi.fn().mockResolvedValue(null) };
  mockPrisma.application = { findMany: vi.fn().mockResolvedValue([{ id: APPLICATION_ID }]) };
});

describe("applications.$domainApplicationId loader — blind review", () => {
  it("blinds the applicant's name when the cycle anonymizes review and nothing is released", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(baseDa({ anonymizeReview: true }));
    mockPrisma.decision.findMany.mockResolvedValue([]); // nothing released

    const result: any = await callLoader();

    expect(result.blinded).toBe(true);
    expect(result.applicantName).toBe("Applicant 1");
  });

  it("passes blinded=true through to priorApplications and email engagement calls", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(baseDa({ anonymizeReview: true }));
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(getApplicantEmailEngagement).mockResolvedValue({
      totals: { inbound: 0, outbound: 0, firstAt: null, lastAt: null },
      threads: [],
    } as never);

    await callLoader();

    expect(listPriorApplications).toHaveBeenCalledWith(
      expect.objectContaining({ hideOutcomes: true }),
    );
    expect(getApplicantEmailEngagement).toHaveBeenCalledWith("u-1", { blinded: true });
  });

  it("shows the real name once the domain's decision is released", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(baseDa({ anonymizeReview: true }));
    mockPrisma.decision.findMany.mockResolvedValue([
      {
        id: "dec-1",
        type: "Standard",
        stage: "Released",
        notes: null,
        waitlistRank: null,
        createdAt: new Date("2026-02-01"),
        madeBy: null,
        domainApplicationId: DA_ID,
      },
    ]);

    const result: any = await callLoader();

    expect(result.blinded).toBe(false);
    expect(result.applicantName).toBe("Ada Lovelace");
  });

  it("does not blind when the cycle has anonymizeReview off", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(baseDa({ anonymizeReview: false }));

    const result: any = await callLoader();

    expect(result.blinded).toBe(false);
    expect(result.applicantName).toBe("Ada Lovelace");
  });
});
