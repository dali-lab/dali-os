import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { loader } from "~/hiring/routes/api.domain-applications.$id.full-context";

const mockPrisma = prisma as unknown as {
  domainApplication: { findUnique: ReturnType<typeof vi.fn> };
  domainApplicationCycle: { findUnique: ReturnType<typeof vi.fn> };
  rubricVersion: { findUnique: ReturnType<typeof vi.fn> };
};

const USER_ID = "user-1";
const DA_ID = "da-1";
const CYCLE_ID = "cycle-1";

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).domainApplication = { findUnique: vi.fn() };
  (mockPrisma as any).domainApplicationCycle = { findUnique: vi.fn() };
  (mockPrisma as any).rubricVersion = { findUnique: vi.fn() };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID },
  } as any);
});

function makeRequest() {
  return new Request(`http://localhost/api/domain-applications/${DA_ID}/full-context`);
}

function setupHappyPathDomainApp() {
  mockPrisma.domainApplication.findUnique.mockResolvedValue({
    id: DA_ID,
    answers: { q1: "challenge answer" },
    challengeVersion: {
      questions: [{ key: "q1", data: { label: "Q1" } }],
      domain: { id: "dom-1", name: "Engineering" },
    },
    application: {
      id: "app-1",
      answers: { g1: "general answer" },
      applicationCycleId: CYCLE_ID,
      user: { firstName: "Ada", lastName: "Lovelace" },
      generalChallengeVersion: {
        questions: [{ key: "g1", data: { label: "G1" } }],
      },
      applicationCycle: { id: CYCLE_ID, generalRubricVersionId: "grv-1" },
    },
    reviews: [
      {
        id: "rev-1",
        scores: { c1: 4 },
        feedback: "good",
        rejectionRationale: "",
        overallRecommendation: "Hire",
        submittedAt: new Date("2026-04-01T00:00:00Z"),
        cycleReviewer: {
          daliMember: { firstName: "Rev", lastName: "Iewer" },
        },
      },
    ],
    decisions: [
      {
        id: "dec-1",
        type: "InvitedToInterview",
        stage: "Draft",
        notes: "moved from Initial delibs",
        createdAt: new Date("2026-04-15T00:00:00Z"),
        madeBy: { firstName: "Lead", lastName: "User" },
      },
    ],
  });
  mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue({
    rubricVersion: { criteria: [{ key: "c1", label: "Craft", maxScore: 5 }] },
  });
  mockPrisma.rubricVersion.findUnique.mockResolvedValue({
    criteria: [{ key: "g1c", label: "General", maxScore: 5 }],
  });
}

describe("GET /api/hiring/domain-applications/:id/full-context", () => {
  it("returns the bundled applicant context for an authorized user", async () => {
    setupHappyPathDomainApp();
    vi.mocked(hasCycleAccess).mockResolvedValue(true);

    const res = await loader({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.application.applicant).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    expect(json.application.answers).toEqual({ g1: "general answer" });
    expect(json.application.generalQuestions).toEqual([{ key: "g1", data: { label: "G1" } }]);
    expect(json.domainApplication.id).toBe(DA_ID);
    expect(json.domainApplication.answers).toEqual({ q1: "challenge answer" });
    expect(json.domainApplication.domain).toEqual({ id: "dom-1", name: "Engineering" });
    expect(json.domainApplication.challengeQuestions).toEqual([
      { key: "q1", data: { label: "Q1" } },
    ]);
    expect(json.reviews).toHaveLength(1);
    expect(json.reviews[0].overallRecommendation).toBe("Hire");
    expect(json.reviews[0].feedback).toBe("good");
    expect(json.reviews[0].rejectionRationale).toBe("");
    expect(json.decisions).toHaveLength(1);
    expect(json.decisions[0].notes).toBe("moved from Initial delibs");
    expect(json.rubric.generalCriteria).toEqual([{ key: "g1c", label: "General", maxScore: 5 }]);
    expect(json.rubric.domainCriteria).toEqual([{ key: "c1", label: "Craft", maxScore: 5 }]);
    expect(hasCycleAccess).toHaveBeenCalledWith(USER_ID, CYCLE_ID);
  });

  it("returns 403 when the user does not have cycle access", async () => {
    setupHappyPathDomainApp();
    vi.mocked(hasCycleAccess).mockResolvedValue(false);

    const res = await loader({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);

    expect(res.status).toBe(403);
  });

  it("returns 404 when the domain application does not exist", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(null);

    const res = await loader({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);

    expect(res.status).toBe(404);
    expect(hasCycleAccess).not.toHaveBeenCalled();
  });

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as any);

    const res = await loader({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);

    expect(res.status).toBe(401);
  });
});
