import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth");
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles, hasCycleAccess } from "~/lib/roles";
import { action } from "~/routes/api.delibs.$id.presence";

const USER_ID = "user-1";
const MEMBER_ID = "member-1";
const SESSION_ID = "delibs-1";
const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "domain-1";

const mockTx: any = {
  delibsSessionParticipant: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
};

const mockPrisma = prisma as unknown as {
  delibsSession: { findUnique: ReturnType<typeof vi.fn> };
  delibsSessionParticipant: {
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  cycleReviewer: { findFirst: ReturnType<typeof vi.fn> };
  domainLeadAssignment: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();

  mockTx.delibsSessionParticipant.findFirst = vi.fn().mockResolvedValue(null);
  mockTx.delibsSessionParticipant.create = vi.fn().mockResolvedValue({});

  (mockPrisma as any).delibsSession = {
    findUnique: vi.fn().mockResolvedValue({
      id: SESSION_ID,
      domainId: DOMAIN_ID,
      applicationCycleId: CYCLE_ID,
      status: "Active",
    }),
  };
  (mockPrisma as any).delibsSessionParticipant = {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  (mockPrisma as any).cycleReviewer = {
    findFirst: vi.fn().mockResolvedValue(null),
  };
  (mockPrisma as any).domainLeadAssignment = {
    findFirst: vi.fn().mockResolvedValue(null),
  };
  (mockPrisma as any).$transaction = vi.fn(async (cb: any) => cb(mockTx));

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID },
  } as any);
  vi.mocked(hasCycleAccess).mockResolvedValue(true);
  vi.mocked(getUserRoles).mockResolvedValue({
    memberId: MEMBER_ID,
    isHiringLead: false,
    isAdmin: false,
    isDomainLead: true,
  });
  (mockPrisma as any).domainLeadAssignment.findFirst.mockResolvedValue({
    id: "dla-1",
  });
});

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/delibs/${SESSION_ID}/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/delibs/:id/presence", () => {
  it("creates a participant row on first join with the resolved role", async () => {
    mockTx.delibsSessionParticipant.findFirst.mockResolvedValue(null);

    const res = await action({
      request: makeRequest({ intent: "join" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockTx.delibsSessionParticipant.create).toHaveBeenCalledTimes(1);
    expect(mockTx.delibsSessionParticipant.create).toHaveBeenCalledWith({
      data: {
        delibsSessionId: SESSION_ID,
        daliMemberId: MEMBER_ID,
        role: "DomainLead",
      },
    });
  });

  it("is a no-op when caller already has an open row (idempotent join)", async () => {
    mockTx.delibsSessionParticipant.findFirst.mockResolvedValue({ id: "p-1" });

    const res = await action({
      request: makeRequest({ intent: "join" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockTx.delibsSessionParticipant.create).not.toHaveBeenCalled();
  });

  it("opens a fresh row when caller has only closed history (rejoin)", async () => {
    // findFirst returns null because the where clause restricts to leftAt: null,
    // even if older closed rows exist. The endpoint must therefore create.
    mockTx.delibsSessionParticipant.findFirst.mockResolvedValue(null);

    const res = await action({
      request: makeRequest({ intent: "join" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockTx.delibsSessionParticipant.create).toHaveBeenCalledTimes(1);
  });

  it("stamps leftAt on the open row when intent=leave", async () => {
    const res = await action({
      request: makeRequest({ intent: "leave" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockPrisma.delibsSessionParticipant.updateMany).toHaveBeenCalledTimes(1);
    const args = (mockPrisma.delibsSessionParticipant.updateMany as any).mock.calls[0][0];
    expect(args.where).toEqual({
      delibsSessionId: SESSION_ID,
      daliMemberId: MEMBER_ID,
      leftAt: null,
    });
    expect(args.data.leftAt).toBeInstanceOf(Date);
  });

  it("treats leave as a no-op when caller has no open row", async () => {
    (mockPrisma.delibsSessionParticipant.updateMany as any).mockResolvedValue({
      count: 0,
    });

    const res = await action({
      request: makeRequest({ intent: "leave" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    // Still 200 — leaving when not present is acceptable.
    expect(res.status).toBe(200);
  });

  it("returns 403 when caller has no DALIMember record", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({
      memberId: null,
      isHiringLead: false,
      isAdmin: false,
      isDomainLead: false,
    });

    const res = await action({
      request: makeRequest({ intent: "join" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(403);
  });

  it("returns 403 when hasCycleAccess is false", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(false);

    const res = await action({
      request: makeRequest({ intent: "join" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 403 when caller has cycle access but no role for this domain (no DLA, no reviewer row)", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({
      memberId: MEMBER_ID,
      isHiringLead: false,
      isAdmin: false,
      isDomainLead: false,
    });
    (mockPrisma.domainLeadAssignment.findFirst as any).mockResolvedValue(null);
    (mockPrisma.cycleReviewer.findFirst as any).mockResolvedValue(null);

    const res = await action({
      request: makeRequest({ intent: "join" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(403);
  });

  it("returns 404 when session does not exist", async () => {
    (mockPrisma.delibsSession.findUnique as any).mockResolvedValue(null);

    const res = await action({
      request: makeRequest({ intent: "join" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(404);
  });

  it("returns 409 when session is already closed and intent is join", async () => {
    (mockPrisma.delibsSession.findUnique as any).mockResolvedValue({
      id: SESSION_ID,
      domainId: DOMAIN_ID,
      applicationCycleId: CYCLE_ID,
      status: "Closed",
    });

    const res = await action({
      request: makeRequest({ intent: "join" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(409);
  });

  it("snapshots role=HiringLead for hiring leads", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({
      memberId: MEMBER_ID,
      isHiringLead: true,
      isAdmin: false,
      isDomainLead: false,
    });

    const res = await action({
      request: makeRequest({ intent: "join" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockTx.delibsSessionParticipant.create).toHaveBeenCalledWith({
      data: {
        delibsSessionId: SESSION_ID,
        daliMemberId: MEMBER_ID,
        role: "HiringLead",
      },
    });
  });

  it("snapshots role=Reviewer when caller is only a cycle reviewer", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({
      memberId: MEMBER_ID,
      isHiringLead: false,
      isAdmin: false,
      isDomainLead: false,
    });
    (mockPrisma.domainLeadAssignment.findFirst as any).mockResolvedValue(null);
    (mockPrisma.cycleReviewer.findFirst as any).mockResolvedValue({ id: "cr-1" });

    const res = await action({
      request: makeRequest({ intent: "join" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockTx.delibsSessionParticipant.create).toHaveBeenCalledWith({
      data: {
        delibsSessionId: SESSION_ID,
        daliMemberId: MEMBER_ID,
        role: "Reviewer",
      },
    });
  });

  it("returns 400 when intent is missing or unknown", async () => {
    const res = await action({
      request: makeRequest({ intent: "wat" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(400);
  });
});
