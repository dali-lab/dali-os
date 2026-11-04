import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
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
  redirectNonMemberToPortal: vi.fn(async () => null),
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/core-cycle", () => ({
  // Tests treat the cycle as a single term ("term-1"); fan-out behavior is
  // exercised through the count of writes, not the cycle math.
  coreCycleTermIds: vi.fn().mockResolvedValue(["term-1"]),
  cycleSortKeyRange: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore, currentTerm } from "~/lib/roles";
import { action } from "~/admin/routes/admin.members";

const CORE_ID = "core-1";
const ADMIN_ID = "admin-1";
const USER_ID = "user-1";
const TERM_ID = "term-1";

const mockPrisma = prisma as unknown as {
  adminMembership: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  coreAssignment: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  domainLeadAssignment: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).adminMembership = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  };
  (mockPrisma as any).coreAssignment = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  };
  (mockPrisma as any).domainLeadAssignment = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({ id: "dla-1" }),
    delete: vi.fn(),
  };
  vi.mocked(currentTerm).mockResolvedValue({ id: TERM_ID } as any);
});

function asCore() {
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: CORE_ID, email: "c@x.com", type: "user" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isAdmin).mockResolvedValue(false);
}

function asAdmin() {
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: ADMIN_ID, email: "a@x.com", type: "user" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isAdmin).mockResolvedValue(true);
}

function asOutsider() {
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "rando-1", email: "r@x.com", type: "user" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isAdmin).mockResolvedValue(false);
}

function postForm(body: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) fd.append(k, v);
  return new Request("http://localhost/admin/members", {
    method: "POST",
    body: fd,
  });
}

describe("admin.members action — gate", () => {
  it("rejects non-Core, non-Admin callers with 403", async () => {
    asOutsider();
    const res = await action({
      request: postForm({ intent: "add-core-title", userId: USER_ID, leadTitle: "PM" }),
      params: {},
      context: {},
    } as any);
    expect((res as Response).status).toBe(403);
    expect(mockPrisma.coreAssignment.create).not.toHaveBeenCalled();
  });
});

describe("admin.members action — add-core-title (Core or Admin)", () => {
  it("materializes a CoreAssignment for every term in the cycle", async () => {
    asCore();
    await action({
      request: postForm({ intent: "add-core-title", userId: USER_ID, leadTitle: "Design Lead" }),
      params: {},
      context: {},
    } as any);
    // Reads existing cycle-mate rows first to compute the missing set.
    expect(mockPrisma.coreAssignment.findMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        termId: { in: [TERM_ID] },
        leadTitle: "Design Lead",
      },
      select: { termId: true },
    });
    expect(mockPrisma.coreAssignment.createMany).toHaveBeenCalledWith({
      data: [{ userId: USER_ID, termId: TERM_ID, leadTitle: "Design Lead" }],
    });
  });

  it("is a no-op when the cycle is already fully covered", async () => {
    asCore();
    mockPrisma.coreAssignment.findMany.mockResolvedValueOnce([{ termId: TERM_ID }]);
    await action({
      request: postForm({ intent: "add-core-title", userId: USER_ID, leadTitle: "PM" }),
      params: {},
      context: {},
    } as any);
    expect(mockPrisma.coreAssignment.createMany).not.toHaveBeenCalled();
  });

  it("treats an empty title as a null (untitled Core) row", async () => {
    asCore();
    await action({
      request: postForm({ intent: "add-core-title", userId: USER_ID, leadTitle: "   " }),
      params: {},
      context: {},
    } as any);
    expect(mockPrisma.coreAssignment.findMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        termId: { in: [TERM_ID] },
        leadTitle: null,
      },
      select: { termId: true },
    });
    expect(mockPrisma.coreAssignment.createMany).toHaveBeenCalledWith({
      data: [{ userId: USER_ID, termId: TERM_ID, leadTitle: null }],
    });
  });
});

describe("admin.members action — remove-core-title", () => {
  it("clears the (userId, leadTitle) across every term in the cycle", async () => {
    asCore();
    // The action looks up the assignment first to resolve (userId, termId, leadTitle).
    mockPrisma.coreAssignment.findUnique.mockResolvedValueOnce({
      userId: USER_ID,
      termId: TERM_ID,
      leadTitle: "Design Lead",
    });
    await action({
      request: postForm({ intent: "remove-core-title", assignmentId: "ca-1" }),
      params: {},
      context: {},
    } as any);
    expect(mockPrisma.coreAssignment.findUnique).toHaveBeenCalledWith({
      where: { id: "ca-1" },
      select: { userId: true, termId: true, leadTitle: true },
    });
    expect(mockPrisma.coreAssignment.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        leadTitle: "Design Lead",
        termId: { in: [TERM_ID] },
      },
    });
  });
});

describe("admin.members action — set-admin (Admin-only)", () => {
  it("rejects Core callers with 403", async () => {
    asCore();
    const res = await action({
      request: postForm({ intent: "set-admin", userId: USER_ID, value: "true" }),
      params: {},
      context: {},
    } as any);
    expect((res as Response).status).toBe(403);
    expect(mockPrisma.adminMembership.upsert).not.toHaveBeenCalled();
  });

  it("allows Admin callers", async () => {
    asAdmin();
    await action({
      request: postForm({ intent: "set-admin", userId: USER_ID, value: "true" }),
      params: {},
      context: {},
    } as any);
    expect(mockPrisma.adminMembership.upsert).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      update: {},
      create: { userId: USER_ID, grantedBy: ADMIN_ID },
    });
  });
});

describe("admin.members action — set-staff (Admin-only)", () => {
  it("rejects Core callers with 403", async () => {
    asCore();
    const res = await action({
      request: postForm({ intent: "set-staff", userId: USER_ID, value: "true" }),
      params: {},
      context: {},
    } as any);
    expect((res as Response).status).toBe(403);
    expect(mockPrisma.adminMembership.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.adminMembership.updateMany).not.toHaveBeenCalled();
  });

  it("marks Staff by upserting the AdminMembership with isStaff (staff ⊂ admin)", async () => {
    asAdmin();
    await action({
      request: postForm({ intent: "set-staff", userId: USER_ID, value: "true" }),
      params: {},
      context: {},
    } as any);
    expect(mockPrisma.adminMembership.upsert).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      update: { isStaff: true },
      create: { userId: USER_ID, grantedBy: ADMIN_ID, isStaff: true },
    });
  });

  it("un-marks Staff by clearing the flag but leaving Admin intact", async () => {
    asAdmin();
    await action({
      request: postForm({ intent: "set-staff", userId: USER_ID, value: "false" }),
      params: {},
      context: {},
    } as any);
    expect(mockPrisma.adminMembership.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { isStaff: false },
    });
    expect(mockPrisma.adminMembership.deleteMany).not.toHaveBeenCalled();
  });
});

function run(body: Record<string, string>) {
  return action({ request: postForm(body), params: {}, context: {} } as any);
}

describe("admin.members action — audit trail", () => {
  it("set-admin on logs role.change from none to Admin", async () => {
    asAdmin();
    await run({ intent: "set-admin", userId: USER_ID, value: "true" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role.change",
        userId: ADMIN_ID,
        targetId: USER_ID,
        metadata: { before: [], after: ["Admin"], targetUserId: USER_ID },
      }),
    );
  });

  it("set-admin off logs the removal", async () => {
    asAdmin();
    mockPrisma.adminMembership.findUnique.mockResolvedValue({ isStaff: false });
    await run({ intent: "set-admin", userId: USER_ID, value: "false" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role.change",
        metadata: { before: ["Admin"], after: [], targetUserId: USER_ID },
      }),
    );
  });

  it("set-admin does not log when nothing changed", async () => {
    asAdmin();
    mockPrisma.adminMembership.findUnique.mockResolvedValue({ isStaff: false });
    await run({ intent: "set-admin", userId: USER_ID, value: "true" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("set-staff logs Staff being added on top of Admin", async () => {
    asAdmin();
    mockPrisma.adminMembership.findUnique.mockResolvedValue({ isStaff: false });
    await run({ intent: "set-staff", userId: USER_ID, value: "true" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role.change",
        targetId: USER_ID,
        metadata: {
          before: ["Admin"],
          after: ["Admin", "Staff"],
          targetUserId: USER_ID,
        },
      }),
    );
  });

  it("set-staff off logs Staff being cleared", async () => {
    asAdmin();
    mockPrisma.adminMembership.findUnique.mockResolvedValue({ isStaff: true });
    await run({ intent: "set-staff", userId: USER_ID, value: "false" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          before: ["Admin", "Staff"],
          after: ["Admin"],
          targetUserId: USER_ID,
        },
      }),
    );
  });

  it("set-staff does not log when already unset", async () => {
    asAdmin();
    await run({ intent: "set-staff", userId: USER_ID, value: "false" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("add-core-title logs the title, and nothing when already covered", async () => {
    asCore();
    await run({ intent: "add-core-title", userId: USER_ID, leadTitle: "PM" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role.change",
        userId: CORE_ID,
        targetId: USER_ID,
        metadata: { before: [], after: ["Core: PM"], targetUserId: USER_ID },
      }),
    );
    vi.mocked(logAuditEvent).mockClear();
    mockPrisma.coreAssignment.findMany.mockResolvedValueOnce([{ termId: TERM_ID }]);
    await run({ intent: "add-core-title", userId: USER_ID, leadTitle: "PM" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("remove-core-title logs the removed title against the assignee", async () => {
    asCore();
    mockPrisma.coreAssignment.findUnique.mockResolvedValueOnce({
      userId: USER_ID,
      termId: TERM_ID,
      leadTitle: "PM",
    });
    await run({ intent: "remove-core-title", assignmentId: "ca-1" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role.change",
        userId: CORE_ID,
        targetId: USER_ID,
        metadata: { before: ["Core: PM"], after: [], targetUserId: USER_ID },
      }),
    );
  });

  it("add-domain-lead logs domain.lead.add only for a new assignment", async () => {
    asCore();
    await run({ intent: "add-domain-lead", userId: USER_ID, domainId: "d1" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "domain.lead.add",
        userId: CORE_ID,
        targetId: USER_ID,
        metadata: { domainId: "d1", assignmentId: "dla-1", termId: TERM_ID },
      }),
    );
    vi.mocked(logAuditEvent).mockClear();
    mockPrisma.domainLeadAssignment.findUnique.mockResolvedValueOnce({ id: "dla-1" });
    await run({ intent: "add-domain-lead", userId: USER_ID, domainId: "d1" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("remove-domain-lead logs domain.lead.remove against the lead", async () => {
    asCore();
    mockPrisma.domainLeadAssignment.delete.mockResolvedValueOnce({
      userId: USER_ID,
      domainId: "d1",
      termId: TERM_ID,
    });
    await run({ intent: "remove-domain-lead", assignmentId: "dla-1" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "domain.lead.remove",
        userId: CORE_ID,
        targetId: USER_ID,
        metadata: { domainId: "d1", assignmentId: "dla-1", termId: TERM_ID },
      }),
    );
  });
});
