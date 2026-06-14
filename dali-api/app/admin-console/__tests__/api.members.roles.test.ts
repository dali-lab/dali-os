import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/core-cycle", () => ({
  // Tests only care that the action runs and validates the request body —
  // not the cycle math — so stub to "current term only".
  coreCycleTermIds: vi.fn().mockResolvedValue(["term-1"]),
  cycleSortKeyRange: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, currentTerm } from "~/lib/roles";
import { action } from "~/admin-console/routes/api.members.$memberId.roles";

const ADMIN_ID = "admin-1";
const USER_ID = "user-1";
const TERM_ID = "term-1";

// Phase 2: the endpoint translates legacy role labels ("Admin", "HiringLead")
// into AdminMembership / CoreAssignment writes. `memberId` in the route param
// is now the User.id.

const mockPrisma = prisma as unknown as {
  adminMembership: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  coreAssignment: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).adminMembership = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  };
  (mockPrisma as any).coreAssignment = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  };
  (mockPrisma as any).user = {
    findUnique: vi.fn().mockResolvedValue({
      id: USER_ID,
      firstName: "Ada",
      lastName: "Lovelace",
      daliEmail: "ada@dali.dartmouth.edu",
      adminMembership: { id: "a1" },
      coreAssignments: [],
    }),
  };
  (mockPrisma as any).$transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma));
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: ADMIN_ID, email: "a@x.com", type: "user" },
  } as any);
  vi.mocked(isAdmin).mockResolvedValue(true);
  vi.mocked(currentTerm).mockResolvedValue({ id: TERM_ID } as any);
});

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/members/${USER_ID}/roles`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/members/:memberId/roles — schema validation", () => {
  it("accepts a valid roles array (Admin)", async () => {
    const res = await action({
      request: makeRequest({ roles: ["Admin"] }),
      params: { memberId: USER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.adminMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } }),
    );
  });

  it("rejects when roles is not an array", async () => {
    const res = await action({
      request: makeRequest({ roles: "Admin" }),
      params: { memberId: USER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.adminMembership.upsert).not.toHaveBeenCalled();
  });

  it("rejects unknown role values", async () => {
    const res = await action({
      request: makeRequest({ roles: ["SuperAdmin"] }),
      params: { memberId: USER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.adminMembership.upsert).not.toHaveBeenCalled();
  });

  it("rejects oversized roles arrays", async () => {
    const res = await action({
      request: makeRequest({ roles: Array(50).fill("Admin") }),
      params: { memberId: USER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.adminMembership.upsert).not.toHaveBeenCalled();
  });
});
