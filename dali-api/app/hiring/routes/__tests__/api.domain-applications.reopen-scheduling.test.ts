import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requireApiSignedOrForbidden: vi.fn() }));
vi.mock("~/hiring/lib/interview-rounds.server", () => ({ invitedRoundId: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { invitedRoundId } from "~/hiring/lib/interview-rounds.server";
import { action } from "~/hiring/routes/api.domain-applications.$id.reopen-scheduling";

const mockPrisma = prisma as unknown as Record<string, any>;

const post = (method = "POST") =>
  action({
    request: new Request("http://localhost/api/hiring/domain-applications/da1/reopen-scheduling", { method }),
    params: { id: "da1" },
    context: {},
  } as any);

const da = (interviews: unknown[], statusUpdates: unknown[] = [{ newStatus: "Submitted" }]) => ({
  id: "da1",
  application: { applicationCycleId: "c1", statusUpdates },
  interviews,
});

const cancelled = { id: "iv1", status: "CancelledByApplicant", interviewRoundId: "interviews" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "lead" } } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(requireApiSignedOrForbidden).mockResolvedValue(null as any);
  vi.mocked(invitedRoundId).mockResolvedValue("interviews");
  mockPrisma.domainApplication = { findUnique: vi.fn().mockResolvedValue(da([cancelled])) };
  mockPrisma.interview = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
});

describe("POST reopen-scheduling", () => {
  it("moves the applicant's cancellation to CancelledByAdmin and audits it", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(mockPrisma.interview.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["iv1"] }, status: "CancelledByApplicant" },
      data: { status: "CancelledByAdmin" },
    });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0]).toMatchObject({
      action: "interview.reopen-scheduling",
      userId: "lead",
      targetId: "da1",
      metadata: { interviewRoundId: "interviews", interviewIds: ["iv1"] },
    });
  });

  it("leaves other rounds' cancellations alone", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(
      da([cancelled, { id: "iv0", status: "CancelledByApplicant", interviewRoundId: "iv2" }]),
    );
    await post();
    expect(mockPrisma.interview.updateMany.mock.calls[0][0].where.id).toEqual({ in: ["iv1"] });
  });

  it("is Core only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await post()).status).toBe(403);
    expect(mockPrisma.interview.updateMany).not.toHaveBeenCalled();
  });

  it("requires the cycle's confidentiality agreement", async () => {
    vi.mocked(requireApiSignedOrForbidden).mockResolvedValue(new Response(null, { status: 403 }) as any);
    expect((await post()).status).toBe(403);
    expect(mockPrisma.interview.updateMany).not.toHaveBeenCalled();
  });

  it("rejects anything but POST", async () => {
    expect((await post("PUT")).status).toBe(405);
  });

  it("404s on an unknown application", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
  });

  it.each([
    ["withdrew the whole application", da([cancelled], [{ newStatus: "Withdrawn" }]), "interviews"],
    ["isn't invited any more", da([cancelled]), null],
    ["never cancelled", da([]), "interviews"],
    ["already rebooked", da([cancelled, { id: "iv2", status: "Scheduled", interviewRoundId: "interviews" }]), "interviews"],
    ["already interviewed", da([cancelled, { id: "iv2", status: "Completed", interviewRoundId: "interviews" }]), "interviews"],
  ])("refuses when the applicant %s", async (_label, row, round) => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(row);
    vi.mocked(invitedRoundId).mockResolvedValue(round);

    expect((await post()).status).toBe(409);
    expect(mockPrisma.interview.updateMany).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
