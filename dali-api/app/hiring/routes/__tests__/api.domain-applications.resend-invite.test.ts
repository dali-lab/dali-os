import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn().mockResolvedValue(true) }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requireApiSignedOrForbidden: vi.fn().mockResolvedValue(null) }));
vi.mock("~/hiring/lib/hiring-emails.server", () => ({ getHiringEmail: vi.fn().mockResolvedValue({ id: "tpl" }) }));
vi.mock("~/hiring/lib/email-variables", () => ({
  renderForSlot: vi.fn(() => ({ subject: "s", html: "h" })),
  notificationSlot: vi.fn((name: string) => name),
}));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn().mockResolvedValue({ id: "m1" }),
  drainNow: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { enqueueOutbound } from "~/lib/outbound.server";
import { action } from "~/hiring/routes/api.domain-applications.$id.resend-invite";

const mockPrisma = prisma as unknown as Record<string, any>;

const post = () =>
  action({
    request: new Request("http://localhost/api/hiring/domain-applications/da1/resend-invite", { method: "POST" }),
    params: { id: "da1" },
    context: {},
  } as any);

const row = (interviews: unknown[], statusUpdates: unknown[] = [{ newStatus: "Submitted" }]) => ({
  id: "da1",
  domain: { id: "d1", name: "Design", displayName: null },
  application: {
    userId: "u1",
    applicationCycleId: "c1",
    statusUpdates,
    user: { firstName: "Ada", dartmouthEmail: "ada@example.edu", netId: "f00000" },
  },
  decisions: [{ type: "InvitedToInterview", interviewRoundId: "interviews" }],
  interviews,
});

const cancelled = { status: "CancelledByApplicant", interviewRoundId: "interviews" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "lead" } } as any);
  mockPrisma.domainApplication = { findUnique: vi.fn() };
});

describe("POST resend-invite", () => {
  it("sends to an applicant who hasn't booked", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(row([]));
    expect((await post()).status).toBe(200);
    expect(enqueueOutbound).toHaveBeenCalledOnce();
  });

  it.each([
    ["cancelled their own interview", row([cancelled])],
    ["withdrew their application", row([], [{ newStatus: "Withdrawn" }])],
    ["is already booked", row([{ status: "Scheduled", interviewRoundId: "interviews" }])],
  ])("sends nothing when the applicant %s", async (_label, da) => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(da);
    expect((await post()).status).toBe(409);
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });
});
