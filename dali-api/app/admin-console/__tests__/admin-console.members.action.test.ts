import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore, currentTerm } from "~/lib/roles";
import { action } from "~/admin-console/routes/admin-console.members";

const CORE_ID = "core-1";
const ADMIN_ID = "admin-1";
const USER_ID = "user-1";
const TERM_ID = "term-1";

const mockPrisma = prisma as unknown as {
  adminMembership: {
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  coreAssignment: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  domainLeadAssignment: {
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).adminMembership = {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  };
  (mockPrisma as any).coreAssignment = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    deleteMany: vi.fn(),
  };
  (mockPrisma as any).domainLeadAssignment = {
    upsert: vi.fn(),
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
  return new Request("http://localhost/admin-console/members", {
    method: "POST",
    body: fd,
  });
}

describe("admin-console.members action — gate", () => {
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

describe("admin-console.members action — add-core-title (Core or Admin)", () => {
  it("creates a CoreAssignment with the free-text title when none exists", async () => {
    asCore();
    await action({
      request: postForm({ intent: "add-core-title", userId: USER_ID, leadTitle: "Design Lead" }),
      params: {},
      context: {},
    } as any);
    expect(mockPrisma.coreAssignment.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, termId: TERM_ID, leadTitle: "Design Lead" },
      select: { id: true },
    });
    expect(mockPrisma.coreAssignment.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, termId: TERM_ID, leadTitle: "Design Lead" },
    });
  });

  it("is a no-op when an identical (user, term, title) row already exists", async () => {
    asCore();
    mockPrisma.coreAssignment.findFirst.mockResolvedValueOnce({ id: "ca-1" });
    await action({
      request: postForm({ intent: "add-core-title", userId: USER_ID, leadTitle: "PM" }),
      params: {},
      context: {},
    } as any);
    expect(mockPrisma.coreAssignment.create).not.toHaveBeenCalled();
  });

  it("treats an empty title as a null (untitled Core) row", async () => {
    asCore();
    await action({
      request: postForm({ intent: "add-core-title", userId: USER_ID, leadTitle: "   " }),
      params: {},
      context: {},
    } as any);
    expect(mockPrisma.coreAssignment.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, termId: TERM_ID, leadTitle: null },
      select: { id: true },
    });
    expect(mockPrisma.coreAssignment.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, termId: TERM_ID, leadTitle: null },
    });
  });
});

// Remove gets a UI confirm step (see RemoveCoreTitleButton) but the server
// still accepts the submit from any Core/Admin caller; the friction is
// client-side only.
describe("admin-console.members action — remove-core-title", () => {
  it("deletes by assignment id", async () => {
    asCore();
    await action({
      request: postForm({ intent: "remove-core-title", assignmentId: "ca-1" }),
      params: {},
      context: {},
    } as any);
    expect(mockPrisma.coreAssignment.deleteMany).toHaveBeenCalledWith({ where: { id: "ca-1" } });
  });
});

describe("admin-console.members action — set-admin (Admin-only)", () => {
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
