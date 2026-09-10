import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), forbidden: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ canManageStaffing: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("../../lib/staffing-events.server", () => ({ publishCycleChange: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageStaffing } from "~/lib/roles";
import { action } from "~/projects/routes/api.staffing.assign";

const USER = "user-lead";
const MEMBER = "member-1";
const CYCLE = "cycle-1";
const TERM = "term-1";
const PROJ_A = "proj-a";
const PROJ_B = "proj-b";
const DOMAIN = "domain-1";

// The transaction body runs against this tx double; assertions read its calls.
const tx = {
  staffingAssignment: {
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  projectAssignment: { deleteMany: vi.fn() },
};

const mockPrisma = prisma as unknown as {
  staffingCycle: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function call(body: unknown) {
  return action({
    request: new Request("http://localhost/api/staffing/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER, email: "l@x.com", type: "user" },
  } as any);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  mockPrisma.staffingCycle = {
    findUnique: vi.fn().mockResolvedValue({ id: CYCLE, termId: TERM }),
  };
  mockPrisma.$transaction = vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx));
});

describe("POST /api/staffing/assign — leaving a project drops the roster row", () => {
  it("move A→B: declines A's Confirmed rows and deletes A's ProjectAssignment", async () => {
    const res = await call({
      userId: MEMBER,
      cycleId: CYCLE,
      projectId: PROJ_B,
      fromProjectId: PROJ_A,
      domains: [{ domainId: DOMAIN, level: "P2" }],
    });
    expect(res.ok).toBe(true);

    // Confirmed rows on the source project are Declined.
    expect(tx.staffingAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        userId: MEMBER,
        staffingCycleId: CYCLE,
        projectId: PROJ_A,
        status: "Confirmed",
      },
      data: { status: "Declined" },
    });
    // The canonical roster row for the source project is removed immediately.
    expect(tx.projectAssignment.deleteMany).toHaveBeenCalledWith({
      where: { userId: MEMBER, projectId: PROJ_A, termId: TERM },
    });
    // A fresh Proposed row lands on the destination project.
    expect(tx.staffingAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: MEMBER,
          projectId: PROJ_B,
          domainId: DOMAIN,
          status: "Proposed",
        }),
      }),
    );
    // Proposed rows on both the source and destination are cleared first.
    expect(tx.staffingAssignment.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: MEMBER,
          staffingCycleId: CYCLE,
          status: "Proposed",
          projectId: { in: expect.arrayContaining([PROJ_A, PROJ_B]) },
        }),
      }),
    );
  });

  it("drag to Unassigned: declines and deletes the source roster row, adds nothing", async () => {
    const res = await call({
      userId: MEMBER,
      cycleId: CYCLE,
      projectId: null,
      fromProjectId: PROJ_A,
    });
    expect(res.ok).toBe(true);

    expect(tx.staffingAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        userId: MEMBER,
        staffingCycleId: CYCLE,
        projectId: PROJ_A,
        status: "Confirmed",
      },
      data: { status: "Declined" },
    });
    expect(tx.projectAssignment.deleteMany).toHaveBeenCalledWith({
      where: { userId: MEMBER, projectId: PROJ_A, termId: TERM },
    });
    expect(tx.staffingAssignment.create).not.toHaveBeenCalled();
  });

  it("add to a second project (no fromProjectId): never touches ProjectAssignment", async () => {
    const res = await call({
      userId: MEMBER,
      cycleId: CYCLE,
      projectId: PROJ_B,
      domains: [{ domainId: DOMAIN, level: "P1" }],
    });
    expect(res.ok).toBe(true);

    expect(tx.projectAssignment.deleteMany).not.toHaveBeenCalled();
    expect(tx.staffingAssignment.updateMany).not.toHaveBeenCalled();
    expect(tx.staffingAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: PROJ_B, status: "Proposed" }),
      }),
    );
  });

  it("full unassign (projectId null, no fromProjectId): drops all Proposed, no roster delete", async () => {
    const res = await call({ userId: MEMBER, cycleId: CYCLE, projectId: null });
    expect(res.ok).toBe(true);

    expect(tx.staffingAssignment.deleteMany).toHaveBeenCalledWith({
      where: { userId: MEMBER, staffingCycleId: CYCLE, status: "Proposed" },
    });
    expect(tx.projectAssignment.deleteMany).not.toHaveBeenCalled();
    expect(tx.staffingAssignment.updateMany).not.toHaveBeenCalled();
  });
});
