import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { action } from "~/admin-console/routes/api.members.$memberId.roles";

const ADMIN_ID = "admin-1";
const MEMBER_ID = "member-1";

const mockPrisma = prisma as unknown as {
  dALIMember: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).dALIMember = {
    findUnique: vi.fn().mockResolvedValue({ roles: [] }),
    update: vi.fn().mockResolvedValue({ id: MEMBER_ID, roles: ["Admin"] }),
  };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: ADMIN_ID, email: "a@x.com", type: "user" },
  } as any);
  vi.mocked(isAdmin).mockResolvedValue(true);
});

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/members/${MEMBER_ID}/roles`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/members/:memberId/roles — schema validation", () => {
  it("accepts a valid roles array", async () => {
    const res = await action({
      request: makeRequest({ roles: ["Admin"] }),
      params: { memberId: MEMBER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.dALIMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { roles: ["Admin"] } }),
    );
  });

  it("rejects when roles is not an array", async () => {
    const res = await action({
      request: makeRequest({ roles: "Admin" }),
      params: { memberId: MEMBER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.dALIMember.update).not.toHaveBeenCalled();
  });

  it("rejects unknown role values", async () => {
    const res = await action({
      request: makeRequest({ roles: ["SuperAdmin"] }),
      params: { memberId: MEMBER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.dALIMember.update).not.toHaveBeenCalled();
  });

  it("rejects oversized roles arrays", async () => {
    const res = await action({
      request: makeRequest({ roles: Array(50).fill("Admin") }),
      params: { memberId: MEMBER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.dALIMember.update).not.toHaveBeenCalled();
  });
});
