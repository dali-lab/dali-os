import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/projects/routes/api.assignment-level";

const CORE_USER = "user-core";
const ASSIGNMENT_ID = "asn-1";
const MEMBER_ID = "member-1";
const PROJECT_ID = "proj-1";
const TERM_ID = "term-1";
const DOMAIN_ID = "domain-1";

const mockPrisma = prisma as unknown as {
  projectAssignment: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  domainEligibility: { findUnique: ReturnType<typeof vi.fn> };
  mentorshipPair: { count: ReturnType<typeof vi.fn> };
};

function req(level: string | null) {
  return new Request(
    `http://localhost/api/projects/assignments/${ASSIGNMENT_ID}/level`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: level === null ? "" : JSON.stringify({ level }),
    },
  );
}

function call(level: string | null) {
  return action({
    request: req(level),
    params: { id: ASSIGNMENT_ID },
  } as any);
}

function mockAssignment(level: "P1" | "P2" | "P3") {
  mockPrisma.projectAssignment.findUnique.mockResolvedValue({
    id: ASSIGNMENT_ID,
    userId: MEMBER_ID,
    projectId: PROJECT_ID,
    termId: TERM_ID,
    domainId: DOMAIN_ID,
    level,
    domain: { displayName: "Design" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: CORE_USER, email: "c@x.com", type: "user" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.projectAssignment = {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  };
  mockPrisma.domainEligibility = { findUnique: vi.fn() };
  mockPrisma.mentorshipPair = { count: vi.fn().mockResolvedValue(0) };
});

describe("POST /api/projects/assignments/:id/level", () => {
  it("rejects non-Core callers with 403", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await call("P2");
    expect(res.status).toBe(403);
    expect(mockPrisma.projectAssignment.update).not.toHaveBeenCalled();
  });

  it("rejects invalid level values with 400", async () => {
    const res = await call("P4");
    expect(res.status).toBe(400);
  });

  it("returns 404 when the assignment does not exist", async () => {
    mockPrisma.projectAssignment.findUnique.mockResolvedValue(null);
    const res = await call("P2");
    expect(res.status).toBe(404);
  });

  it("no-ops when the requested level equals the current level", async () => {
    mockAssignment("P2");
    const res = await call("P2");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, unchanged: true });
    expect(mockPrisma.projectAssignment.update).not.toHaveBeenCalled();
    expect(mockPrisma.domainEligibility.findUnique).not.toHaveBeenCalled();
  });

  it("blocks promotion above eligibility ceiling", async () => {
    mockAssignment("P1");
    mockPrisma.domainEligibility.findUnique.mockResolvedValue({ level: "P2" });
    const res = await call("P3");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Promote") });
    expect(mockPrisma.projectAssignment.update).not.toHaveBeenCalled();
  });

  it("blocks any change when no eligibility row exists", async () => {
    mockAssignment("P1");
    mockPrisma.domainEligibility.findUnique.mockResolvedValue(null);
    const res = await call("P2");
    expect(res.status).toBe(400);
    expect(mockPrisma.projectAssignment.update).not.toHaveBeenCalled();
  });

  it("blocks demotion while mentor still has mentees on the scope", async () => {
    mockAssignment("P3");
    mockPrisma.domainEligibility.findUnique.mockResolvedValue({ level: "P3" });
    mockPrisma.mentorshipPair.count.mockResolvedValue(2);
    const res = await call("P1");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("2 mentees") });
    expect(mockPrisma.projectAssignment.update).not.toHaveBeenCalled();
    expect(mockPrisma.mentorshipPair.count).toHaveBeenCalledWith({
      where: {
        mentorUserId: MEMBER_ID,
        projectId: PROJECT_ID,
        termId: TERM_ID,
        domainId: DOMAIN_ID,
      },
    });
  });

  it("allows promotion when within eligibility ceiling", async () => {
    mockAssignment("P1");
    mockPrisma.domainEligibility.findUnique.mockResolvedValue({ level: "P3" });
    const res = await call("P3");
    expect(res.status).toBe(200);
    expect(mockPrisma.projectAssignment.update).toHaveBeenCalledWith({
      where: { id: ASSIGNMENT_ID },
      data: { level: "P3" },
    });
    expect(mockPrisma.mentorshipPair.count).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.assignment.level",
        userId: CORE_USER,
        targetId: MEMBER_ID,
        metadata: expect.objectContaining({ from: "P1", to: "P3" }),
      }),
    );
  });

  it("allows demotion when no active mentees on the scope", async () => {
    mockAssignment("P3");
    mockPrisma.domainEligibility.findUnique.mockResolvedValue({ level: "P3" });
    mockPrisma.mentorshipPair.count.mockResolvedValue(0);
    const res = await call("P2");
    expect(res.status).toBe(200);
    expect(mockPrisma.projectAssignment.update).toHaveBeenCalledWith({
      where: { id: ASSIGNMENT_ID },
      data: { level: "P2" },
    });
  });
});
