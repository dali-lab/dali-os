import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
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
  redirectApplicantToPortal: vi.fn(() => null),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth, requireCoreOrDomainLead } from "~/lib/auth";
import { isCore, isDomainLead } from "~/lib/roles";
import { action } from "~/hiring/routes/api.cycles.$cycleId.interviewers";

const mockPrisma = prisma as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
  interviewAssignment: {
    count: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  cycleInterviewer: { delete: ReturnType<typeof vi.fn> };
};

const USER_ID = "user-1";
const CYCLE_ID = "cycle-1";
const INTERVIEWER_ID = "interviewer-1";

function makeDeleteRequest(body: unknown = { interviewerId: INTERVIEWER_ID }) {
  return new Request(`http://localhost/api/cycles/${CYCLE_ID}/interviewers`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).interviewAssignment = {
    count: vi.fn().mockResolvedValue(0),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  (mockPrisma as any).cycleInterviewer = {
    delete: vi.fn().mockResolvedValue({ id: INTERVIEWER_ID }),
  };
  (mockPrisma as any).$transaction = vi.fn(async (cb: any) => cb(mockPrisma));
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
  vi.mocked(requireCoreOrDomainLead).mockResolvedValue({
    ok: true,
    auth: {
      ok: true,
      user: { sub: USER_ID, email: "u@x.com", type: "user" },
      sessionId: "sid",
    },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isDomainLead).mockResolvedValue(false);
});

describe("DELETE /api/hiring/cycles/:cycleId/interviewers", () => {
  it("returns 403 when caller is not a hiring or domain lead", async () => {
    vi.mocked(isCore).mockResolvedValueOnce(false);
    vi.mocked(isDomainLead).mockResolvedValueOnce(false);
    vi.mocked(requireCoreOrDomainLead).mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await action({
      request: makeDeleteRequest(),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(403);
    expect(mockPrisma.cycleInterviewer.delete).not.toHaveBeenCalled();
  });

  it("removes a clean interviewer (no assignments)", async () => {
    const res = await action({
      request: makeDeleteRequest(),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.interviewAssignment.count).toHaveBeenCalledWith({
      where: {
        cycleInterviewerId: INTERVIEWER_ID,
        status: "Active",
        interview: { status: "Scheduled" },
      },
    });
    expect(mockPrisma.interviewAssignment.deleteMany).toHaveBeenCalledWith({
      where: { cycleInterviewerId: INTERVIEWER_ID },
    });
    expect(mockPrisma.cycleInterviewer.delete).toHaveBeenCalledWith({
      where: { id: INTERVIEWER_ID },
    });
  });

  it("returns 409 when interviewer has scheduled+active assignments", async () => {
    mockPrisma.interviewAssignment.count.mockResolvedValueOnce(2);
    const res = await action({
      request: makeDeleteRequest(),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/2 scheduled interviews/);
    expect(mockPrisma.interviewAssignment.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.cycleInterviewer.delete).not.toHaveBeenCalled();
  });

  it("uses singular wording when there is exactly one scheduled interview", async () => {
    mockPrisma.interviewAssignment.count.mockResolvedValueOnce(1);
    const res = await action({
      request: makeDeleteRequest(),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/1 scheduled interview\b/);
    expect(json.error).not.toMatch(/scheduled interviews/);
  });

  it("removes interviewer with only historical (non-active or non-scheduled) assignments", async () => {
    mockPrisma.interviewAssignment.count.mockResolvedValueOnce(0);
    mockPrisma.interviewAssignment.deleteMany.mockResolvedValueOnce({ count: 3 });
    const res = await action({
      request: makeDeleteRequest(),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.interviewAssignment.deleteMany).toHaveBeenCalledWith({
      where: { cycleInterviewerId: INTERVIEWER_ID },
    });
    expect(mockPrisma.cycleInterviewer.delete).toHaveBeenCalledWith({
      where: { id: INTERVIEWER_ID },
    });
  });

  it("returns 404 when the interviewer row is missing (P2025)", async () => {
    mockPrisma.cycleInterviewer.delete.mockRejectedValueOnce({ code: "P2025" });
    const res = await action({
      request: makeDeleteRequest(),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(404);
  });
});
