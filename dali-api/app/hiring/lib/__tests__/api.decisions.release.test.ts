import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  withAuth: <T,>(_auth: unknown, value: T) => value,
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/gmail");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { sendEmail } from "~/lib/gmail";
import { action } from "~/hiring/routes/api.decisions.$id.release";

const mockPrisma = prisma as unknown as {
  dALIMember: { findFirst: ReturnType<typeof vi.fn> };
  decision: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  domainApplication: { findUnique: ReturnType<typeof vi.fn> };
  cycleDecisionEmail: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

const USER_ID = "user-hl";
const MEMBER_ID = "member-hl";
const DECISION_ID = "dec-1";
const CYCLE_ID = "cycle-1";

function setupAuth() {
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER_ID } } as any);
  vi.mocked(isHiringLead).mockResolvedValue(true);
  mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: MEMBER_ID, userId: USER_ID });
}

function setupFinalDecision(type: "Rejected" | "InvitedToInterview" | "Accepted" | "Waitlisted" = "Accepted") {
  mockPrisma.decision.findUnique.mockResolvedValue({
    id: DECISION_ID,
    stage: "Final",
    type,
    domainApplicationId: "da-1",
    notes: null,
    waitlistRank: null,
  });
  mockPrisma.decision.create.mockResolvedValue({
    id: "dec-released",
    stage: "Released",
    type,
  });
}

function setupApplicantContext(opts: { domainName?: string | null } = {}) {
  const domainName = opts.domainName === undefined ? "Engineering" : opts.domainName;
  mockPrisma.domainApplication.findUnique.mockResolvedValue({
    id: "da-1",
    selected: true,
    challengeVersion: { domain: domainName ? { name: domainName } : null },
    application: {
      applicationCycleId: CYCLE_ID,
      user: {
        firstName: "Ada",
        dartmouthEmail: "ada@dartmouth.edu",
        netId: null,
      },
    },
  });
  mockPrisma.user.findUnique.mockResolvedValue({ googleRefreshToken: "gmail-rt" });
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).dALIMember = { findFirst: vi.fn() };
  (mockPrisma as any).decision = { findUnique: vi.fn(), create: vi.fn() };
  (mockPrisma as any).domainApplication = { findUnique: vi.fn() };
  (mockPrisma as any).cycleDecisionEmail = { findUnique: vi.fn() };
  (mockPrisma as any).user = { findUnique: vi.fn() };
  vi.mocked(sendEmail).mockResolvedValue(undefined as any);
});

function makeRequest() {
  return new Request("http://localhost/api/decisions/dec-1/release", { method: "POST" });
}

describe("POST /api/hiring/decisions/:id/release", () => {
  it("sends email using the cycle-bound template version when a binding exists", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext();
    mockPrisma.cycleDecisionEmail.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      decisionType: "Accepted",
      emailTemplateVersionId: "etv-1",
      emailTemplateVersion: {
        id: "etv-1",
        subject: "Welcome, {{firstName}}!",
        body: "Hi {{firstName}},\n\nYou're in.",
      },
    });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);

    expect(mockPrisma.cycleDecisionEmail.findUnique).toHaveBeenCalledWith({
      where: {
        applicationCycleId_decisionType: {
          applicationCycleId: CYCLE_ID,
          decisionType: "Accepted",
        },
      },
      include: { emailTemplateVersion: true },
    });
    expect(sendEmail).toHaveBeenCalledOnce();
    const args = vi.mocked(sendEmail).mock.calls[0][0];
    expect(args.to).toBe("ada@dartmouth.edu");
    expect(args.subject).toBe("Welcome, Ada!");
    expect(args.html).toContain("Hi Ada,");
    expect(args.refreshToken).toBe("gmail-rt");
  });

  it("interpolates {{domain}} from domainApplication.challengeVersion.domain.name", async () => {
    setupAuth();
    setupFinalDecision("Rejected");
    setupApplicantContext({ domainName: "Design" });
    mockPrisma.cycleDecisionEmail.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      decisionType: "Rejected",
      emailTemplateVersionId: "etv-rej",
      emailTemplateVersion: {
        id: "etv-rej",
        subject: "Your {{domain}} application",
        body: "Hi {{firstName}}, regarding {{domain}}.",
      },
    });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    const args = vi.mocked(sendEmail).mock.calls[0][0];
    expect(args.subject).toBe("Your Design application");
    expect(args.html).toContain("Hi Ada, regarding Design.");
  });

  it("substitutes {{domain}} with empty string when the challenge version has no domain", async () => {
    setupAuth();
    setupFinalDecision("Rejected");
    setupApplicantContext({ domainName: null });
    mockPrisma.cycleDecisionEmail.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      decisionType: "Rejected",
      emailTemplateVersionId: "etv-rej",
      emailTemplateVersion: {
        id: "etv-rej",
        subject: "About {{domain}}",
        body: "{{firstName}} / {{domain}}",
      },
    });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    const args = vi.mocked(sendEmail).mock.calls[0][0];
    expect(args.subject).toBe("About ");
    expect(args.html).toContain("Ada / ");
  });

  it("returns 409 and does not create the released decision when no binding exists", async () => {
    setupAuth();
    setupFinalDecision("Rejected");
    setupApplicantContext();
    mockPrisma.cycleDecisionEmail.findUnique.mockResolvedValue(null);

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Rejected/);
    expect(body.error).toMatch(/Setup tab/);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns 409 when the decision is not Final", async () => {
    setupAuth();
    mockPrisma.decision.findUnique.mockResolvedValue({
      id: DECISION_ID,
      stage: "Draft",
      type: "Accepted",
      domainApplicationId: "da-1",
      notes: null,
      waitlistRank: null,
    });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(409);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not a hiring lead", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER_ID } } as any);
    vi.mocked(isHiringLead).mockResolvedValue(false);

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(403);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("falls back to netId@dartmouth.edu when dartmouthEmail is missing", async () => {
    setupAuth();
    setupFinalDecision("InvitedToInterview");
    mockPrisma.domainApplication.findUnique.mockResolvedValue({
      id: "da-1",
      selected: true,
      challengeVersion: { domain: { name: "Engineering" } },
      application: {
        applicationCycleId: CYCLE_ID,
        user: {
          firstName: "Grace",
          dartmouthEmail: null,
          netId: "f00abc",
        },
      },
    });
    mockPrisma.user.findUnique.mockResolvedValue({ googleRefreshToken: "gmail-rt" });
    mockPrisma.cycleDecisionEmail.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      decisionType: "InvitedToInterview",
      emailTemplateVersionId: "etv-2",
      emailTemplateVersion: {
        id: "etv-2",
        subject: "Interview invite",
        body: "Hi {{firstName}}",
      },
    });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(vi.mocked(sendEmail).mock.calls[0][0].to).toBe("f00abc@dartmouth.edu");
  });

  it("does not throw when sendEmail fails", async () => {
    setupAuth();
    setupFinalDecision("Waitlisted");
    setupApplicantContext();
    mockPrisma.cycleDecisionEmail.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      decisionType: "Waitlisted",
      emailTemplateVersionId: "etv-3",
      emailTemplateVersion: { id: "etv-3", subject: "x", body: "y" },
    });
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("gmail down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
