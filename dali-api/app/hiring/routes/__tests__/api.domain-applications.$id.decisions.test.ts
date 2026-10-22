// Moving an applicant to a stage without a delib goes through this endpoint:
// it writes the same Draft decision a closed board would, and only the cycle's
// hiring lead or the application's own domain lead may write it.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/roles");
vi.mock("~/hiring/lib/confidentiality", () => ({
  requireApiSignedOrForbidden: vi.fn().mockResolvedValue(null),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCycleAdmin, isDomainLeadForCycle } from "~/lib/roles";
import { action } from "~/hiring/routes/api.domain-applications.$id.decisions";

const mockPrisma = prisma as unknown as Record<string, any>;

const USER_ID = "user-1";
const DA_ID = "da-1";
const DOMAIN_ID = "domain-1";

function post(body: unknown) {
  return action({
    request: new Request(`http://localhost/api/hiring/domain-applications/${DA_ID}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: DA_ID },
    context: {},
  } as any) as Promise<Response>;
}

const TWO_ROUND_TIMELINE = [
  { kind: "phase", key: "setup", weeks: [1, 5] },
  { kind: "phase", key: "review", weeks: [6, 6] },
  { kind: "delib", id: "first", label: "First delib", weeks: [6, 6] },
  { kind: "phase", key: "interviews", weeks: [7, 7] },
  { kind: "delib", id: "r3", label: "Delib 3", weeks: [8, 8] },
  { kind: "phase", key: "interviews", id: "iv2", label: "Interviews 2", weeks: [9, 9] },
  { kind: "delib", id: "final", label: "Final delib", weeks: [10, 10] },
  { kind: "phase", key: "decisions", weeks: [11, 11] },
];

const draftMove = { type: "InvitedToInterview", stage: "Draft", notes: "Moved without delibs." };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "lead@x.com", type: "user" },
  } as any);
  vi.mocked(isCycleAdmin).mockResolvedValue(false);
  vi.mocked(isDomainLeadForCycle).mockResolvedValue(false);
  mockPrisma.domainApplication = {
    findUnique: vi.fn().mockResolvedValue({
      domainId: DOMAIN_ID,
      application: { applicationCycleId: "c1", applicationCycle: { timeline: TWO_ROUND_TIMELINE } },
      interviews: [],
      decisions: [],
    }),
  };
  mockPrisma.dALIMember = { findUnique: vi.fn().mockResolvedValue({ id: "m1", userId: USER_ID }) };
  mockPrisma.domainLeadAssignment = { findFirst: vi.fn().mockResolvedValue(null) };
  mockPrisma.decision = {
    create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "dec-1", ...data })),
  };
});

describe("POST /api/hiring/domain-applications/:id/decisions", () => {
  it("lets the application's own domain lead record a draft decision", async () => {
    vi.mocked(isDomainLeadForCycle).mockResolvedValue(true);
    mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue({ id: "a1" });

    const res = await post(draftMove);

    expect(res.status).toBe(201);
    expect(mockPrisma.decision.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.decision.create.mock.calls[0][0].data).toMatchObject({
      domainApplicationId: DA_ID,
      type: "InvitedToInterview",
      stage: "Draft",
      madeById: USER_ID,
      notes: "Moved without delibs.",
    });
    // A move is a draft: nothing is finalized or released here.
    expect(mockPrisma.domainLeadAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, domainId: DOMAIN_ID } }),
    );
  });

  it("puts a hand-made invite in the first Interviews round when none is done", async () => {
    vi.mocked(isCycleAdmin).mockResolvedValue(true);
    await post(draftMove);
    expect(mockPrisma.decision.create.mock.calls[0][0].data.interviewRoundId).toBe("interviews");
  });

  it("puts a hand-made invite in the next round once the applicant interviewed", async () => {
    vi.mocked(isCycleAdmin).mockResolvedValue(true);
    mockPrisma.domainApplication.findUnique.mockResolvedValue({
      domainId: DOMAIN_ID,
      application: { applicationCycleId: "c1", applicationCycle: { timeline: TWO_ROUND_TIMELINE } },
      interviews: [{ interviewRoundId: "interviews" }],
      decisions: [{ interviewRoundId: "interviews" }],
    });
    await post(draftMove);
    expect(mockPrisma.decision.create.mock.calls[0][0].data.interviewRoundId).toBe("iv2");
  });

  it("leaves the round off decisions that aren't invites", async () => {
    vi.mocked(isCycleAdmin).mockResolvedValue(true);
    await post({ type: "Rejected", stage: "Draft" });
    expect(mockPrisma.decision.create.mock.calls[0][0].data.interviewRoundId).toBeNull();
  });

  it("lets the hiring lead record one without a domain assignment", async () => {
    vi.mocked(isCycleAdmin).mockResolvedValue(true);
    const res = await post(draftMove);
    expect(res.status).toBe(201);
  });

  it("refuses a domain lead of some other domain", async () => {
    vi.mocked(isDomainLeadForCycle).mockResolvedValue(true);
    mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue(null);

    const res = await post(draftMove);

    expect(res.status).toBe(403);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
  });

  it("refuses someone who leads nothing", async () => {
    const res = await post(draftMove);
    expect(res.status).toBe(403);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
  });

  it("still keeps releasing to the hiring lead", async () => {
    vi.mocked(isDomainLeadForCycle).mockResolvedValue(true);
    mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue({ id: "a1" });

    const res = await post({ type: "Accepted", stage: "Released" });

    expect(res.status).toBe(403);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
  });
});
