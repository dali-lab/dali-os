import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  requireCore: vi.fn(),
  requireCoreOrDomainLead: vi.fn(),
  requireMemberSession: vi.fn(),
  forbidden: vi.fn((_req: Request) =>
    Response.json({ error: "Forbidden" }, { status: 403 }),
  ),
  unauthorized: vi.fn((_req: Request) =>
    Response.json({ error: "Unauthorized" }, { status: 401 }),
  ),
  redirectApplicantToPortal: vi.fn(() => null),
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/gmail");

import { prisma } from "~/lib/db";
import {
  requireAuth,
  requireCoreOrDomainLead,
  requireMemberSession,
} from "~/lib/auth";
import { isCore, isDomainLead, hasCycleAccess } from "~/lib/roles";
import { sendEmail } from "~/lib/gmail";
import { action as finalizeAction } from "~/hiring/routes/api.decisions.$id.finalize";
import { action as releaseAction } from "~/hiring/routes/api.decisions.$id.release";
import { action as delibsAction } from "~/hiring/routes/api.delibs.$id";
import { loader as decisionsLoader } from "~/hiring/routes/api.domain-applications.$id.decisions";

const mockPrisma = prisma as unknown as {
  dALIMember: { findUnique: ReturnType<typeof vi.fn> };
  gmailIntegration: { findFirst: ReturnType<typeof vi.fn> };
  decision: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  domainApplication: { findUnique: ReturnType<typeof vi.fn> };
  cycleDecisionEmail: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  delibsSession: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

const USER_ID = "user-1";
const MEMBER_ID = "member-1";
const DRAFT_ID = "dec-draft";
const FINAL_ID = "dec-final";

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).dALIMember = { findUnique: vi.fn() };
  (mockPrisma as any).gmailIntegration = { findFirst: vi.fn() };
  (mockPrisma as any).decision = { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() };
  (mockPrisma as any).domainApplication = { findUnique: vi.fn() };
  (mockPrisma as any).cycleDecisionEmail = { findUnique: vi.fn() };
  (mockPrisma as any).user = { findUnique: vi.fn() };
  (mockPrisma as any).delibsSession = { findUnique: vi.fn(), update: vi.fn() };
  (mockPrisma as any).$transaction = vi.fn(async (fn: any) => fn(mockPrisma));
  vi.mocked(sendEmail).mockResolvedValue(undefined as any);
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER_ID } } as any);
  const okGate = {
    ok: true as const,
    auth: {
      ok: true as const,
      user: { sub: USER_ID, email: "u@x.com", type: "member" },
      sessionId: "sid",
    },
  };
  vi.mocked(requireCoreOrDomainLead).mockResolvedValue(okGate as any);
  vi.mocked(requireMemberSession).mockResolvedValue(okGate as any);
  mockPrisma.dALIMember.findUnique.mockResolvedValue({ id: MEMBER_ID, userId: USER_ID });
});

describe("Decision lineage (parentDecisionId)", () => {
  it("finalize: links the new Final record to its Draft predecessor", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isDomainLead).mockResolvedValue(false);
    mockPrisma.decision.findUnique.mockResolvedValue({
      id: DRAFT_ID,
      stage: "Draft",
      type: "Accepted",
      domainApplicationId: "da-1",
      notes: "drafted",
      waitlistRank: null,
      domainApplication: { application: { applicationCycleId: "cycle-1" } },
    });
    mockPrisma.decision.findFirst.mockResolvedValue(null); // no existing Final
    mockPrisma.decision.create.mockResolvedValue({ id: FINAL_ID });

    const req = new Request("http://localhost/api/decisions/dec-draft/finalize", { method: "POST" });
    const res = await finalizeAction({ request: req, params: { id: DRAFT_ID }, context: {} } as any);
    expect(res.status).toBe(201);

    const arg = mockPrisma.decision.create.mock.calls[0][0];
    expect(arg.data.stage).toBe("Final");
    expect(arg.data.parentDecisionId).toBe(DRAFT_ID);
    // Phase 2: Decision.madeById points at User.id (auth.user.sub) instead of
    // DALIMember.id. The test mock's `member` is the DALIMember row; the
    // actual stored value is the authenticated user.
    expect(arg.data.madeById).toBe(USER_ID);
  });

  it("finalize: 409s without creating a duplicate when a Final already exists", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isDomainLead).mockResolvedValue(false);
    mockPrisma.decision.findUnique.mockResolvedValue({
      id: DRAFT_ID,
      stage: "Draft",
      type: "Accepted",
      domainApplicationId: "da-1",
      notes: null,
      waitlistRank: null,
      domainApplication: { application: { applicationCycleId: "cycle-1" } },
    });
    // A Final of this type already exists (e.g. a double-click after the first
    // finalize landed) → the guard short-circuits before creating a second.
    mockPrisma.decision.findFirst.mockResolvedValue({ id: FINAL_ID });

    const req = new Request("http://localhost/api/decisions/dec-draft/finalize", { method: "POST" });
    const res = await finalizeAction({ request: req, params: { id: DRAFT_ID }, context: {} } as any);
    expect(res.status).toBe(409);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
  });

  it("release: links the new Released record to its Final predecessor", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.decision.findUnique.mockResolvedValue({
      id: FINAL_ID,
      stage: "Final",
      type: "Rejected",
      domainApplicationId: "da-1",
      notes: null,
      waitlistRank: null,
    });
    mockPrisma.decision.create.mockResolvedValue({ id: "dec-released" });
    mockPrisma.domainApplication.findUnique.mockResolvedValue({
      domain: { id: "dom-1", name: "Engineering", displayName: "Engineering" },
      application: {
        userId: "applicant-user-id",
        applicationCycleId: "cycle-1",
        applicationCycle: { cycleType: "Standard" },
        user: { firstName: "Test", dartmouthEmail: null, netId: null },
      },
    });
    mockPrisma.cycleDecisionEmail.findUnique.mockResolvedValue({
      emailTemplateVersion: { id: "etv-1", subject: "s", body: "b" },
    });
    mockPrisma.gmailIntegration.findFirst.mockResolvedValue(null);

    const req = new Request("http://localhost/api/decisions/dec-final/release", { method: "POST" });
    const res = await releaseAction({ request: req, params: { id: FINAL_ID }, context: {} } as any);
    expect(res.status).toBe(201);

    const arg = mockPrisma.decision.create.mock.calls[0][0];
    expect(arg.data.stage).toBe("Released");
    expect(arg.data.parentDecisionId).toBe(FINAL_ID);
  });

  it("delibs close: leaves parentDecisionId unset (no Draft predecessor exists)", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isDomainLead).mockResolvedValue(true);
    mockPrisma.delibsSession.findUnique.mockResolvedValue({
      id: "session-1",
      type: "Final",
      columnOrder: { Accept: ["da-a"], Waitlist: ["da-w"], Reject: ["da-r"] },
    });
    mockPrisma.decision.create.mockResolvedValue({});
    mockPrisma.delibsSession.update.mockResolvedValue({});

    const req = new Request("http://localhost/api/delibs/session-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "close" }),
    });
    const res = await delibsAction({ request: req, params: { id: "session-1" }, context: {} } as any);
    expect(res.status).toBe(200);

    expect(mockPrisma.decision.create).toHaveBeenCalledTimes(3);
    for (const call of mockPrisma.decision.create.mock.calls) {
      expect(call[0].data.parentDecisionId).toBeUndefined();
      expect(call[0].data.stage).toBe("Draft");
    }
  });

  it("decisions loader: includes parent so callers can render drafter alongside finalizer", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    mockPrisma.domainApplication.findUnique.mockResolvedValue({
      application: { applicationCycleId: "cycle-1" },
    });
    mockPrisma.decision.findMany.mockResolvedValue([
      {
        id: FINAL_ID,
        stage: "Final",
        madeBy: { firstName: "Finn", lastName: "Finalizer" },
        parent: {
          id: DRAFT_ID,
          stage: "Draft",
          madeBy: { firstName: "Drew", lastName: "Drafter" },
        },
      },
    ]);

    const req = new Request("http://localhost/api/domain-applications/da-1/decisions");
    const res = await decisionsLoader({ request: req, params: { id: "da-1" }, context: {} } as any);
    expect(res.status).toBe(200);

    expect(mockPrisma.decision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          parent: expect.objectContaining({
            include: { madeBy: { select: { firstName: true, lastName: true } } },
          }),
        }),
      }),
    );

    const body = await res.json();
    expect(body[0].parent.madeBy.firstName).toBe("Drew");
    expect(body[0].madeBy.firstName).toBe("Finn");
  });
});
