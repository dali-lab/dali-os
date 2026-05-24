import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isDomainLead } from "~/lib/roles";
import { action } from "~/hiring/routes/api.delibs.$id";

const USER_ID = "user-hl";
const MEMBER_ID = "member-hl";
const SESSION_ID = "session-1";

const mockTx: any = {
  decision: { create: vi.fn() },
  delibsSession: { update: vi.fn() },
};

const mockPrisma = prisma as unknown as {
  dALIMember: { findUnique: ReturnType<typeof vi.fn> };
  delibsSession: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();

  mockTx.decision.create = vi.fn().mockResolvedValue({});
  mockTx.delibsSession.update = vi.fn().mockResolvedValue({});

  (mockPrisma as any).dALIMember = { findUnique: vi.fn() };
  (mockPrisma as any).delibsSession = { findUnique: vi.fn(), update: vi.fn() };
  (mockPrisma as any).$transaction = vi.fn(async (cb: any) => cb(mockTx));

  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER_ID } } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isDomainLead).mockResolvedValue(false);
  mockPrisma.dALIMember.findUnique.mockResolvedValue({ id: MEMBER_ID, userId: USER_ID });
});

function makeCloseRequest() {
  return new Request(`http://localhost/api/delibs/${SESSION_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "close" }),
  });
}

describe("POST /api/hiring/delibs/:id (intent=close)", () => {
  it("creates Draft decisions and assigns waitlist ranks starting at 1 even when Accepts precede them", async () => {
    mockPrisma.delibsSession.findUnique.mockResolvedValue({
      id: SESSION_ID,
      type: "Final",
      columnOrder: {
        Accept: ["da-accept-1"],
        Waitlist: ["da-wait-1", "da-wait-2"],
        Reject: [],
      },
    });

    const res = await action({
      request: makeCloseRequest(),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockTx.decision.create).toHaveBeenCalledTimes(3);

    const calls = mockTx.decision.create.mock.calls.map((c: any[]) => c[0].data);
    const accept = calls.find((d: any) => d.domainApplicationId === "da-accept-1");
    const wait1 = calls.find((d: any) => d.domainApplicationId === "da-wait-1");
    const wait2 = calls.find((d: any) => d.domainApplicationId === "da-wait-2");

    expect(accept).toMatchObject({ type: "Accepted", stage: "Draft", waitlistRank: null });
    expect(wait1).toMatchObject({ type: "Waitlisted", stage: "Draft", waitlistRank: 1 });
    expect(wait2).toMatchObject({ type: "Waitlisted", stage: "Draft", waitlistRank: 2 });

    expect(mockTx.delibsSession.update).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      data: { status: "Closed" },
    });
  });

  it("sets waitlistRank to null on Accept and Reject decisions", async () => {
    mockPrisma.delibsSession.findUnique.mockResolvedValue({
      id: SESSION_ID,
      type: "Final",
      columnOrder: {
        Accept: ["da-accept-1", "da-accept-2"],
        Waitlist: [],
        Reject: ["da-reject-1"],
      },
    });

    const res = await action({
      request: makeCloseRequest(),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    const calls = mockTx.decision.create.mock.calls.map((c: any[]) => c[0].data);
    expect(calls).toHaveLength(3);
    for (const data of calls) {
      if (data.type === "Accepted" || data.type === "Rejected") {
        expect(data.waitlistRank).toBeNull();
      }
    }
  });

  it("creates Draft decisions for Initial sessions with no waitlistRank", async () => {
    mockPrisma.delibsSession.findUnique.mockResolvedValue({
      id: SESSION_ID,
      type: "Initial",
      columnOrder: {
        Interview: ["da-int-1", "da-int-2"],
        Reject: ["da-rej-1"],
      },
    });

    const res = await action({
      request: makeCloseRequest(),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    const calls = mockTx.decision.create.mock.calls.map((c: any[]) => c[0].data);
    expect(calls).toHaveLength(3);

    const types = calls.map((d: any) => d.type).sort();
    expect(types).toEqual(["InvitedToInterview", "InvitedToInterview", "Rejected"]);
    for (const data of calls) {
      expect(data.stage).toBe("Draft");
      expect(data.waitlistRank).toBeNull();
    }
  });
});
