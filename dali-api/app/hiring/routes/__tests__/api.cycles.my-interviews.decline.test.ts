import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/confidentiality", () => ({
  requireApiSignedOrForbidden: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/hiring/lib/scheduling", () => ({
  reassignInterviewer: vi.fn(),
  isNoReplacementError: (err: Error) => err.message === "none",
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { reassignInterviewer } from "~/hiring/lib/scheduling";
import { action } from "~/hiring/routes/api.cycles.$cycleId.my-interviews.$interviewId.decline";

const db = prisma as any;

const call = () =>
  action({
    request: new Request("http://localhost/x", { method: "POST" }),
    params: { cycleId: "c1", interviewId: "iv1" },
    context: {},
  } as any) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u-ada" } } as any);
  db.dALIMember = { findUnique: vi.fn().mockResolvedValue({ id: "m1" }) };
  db.cycleInterviewer = { findMany: vi.fn().mockResolvedValue([{ id: "ci-1" }, { id: "ci-2" }]) };
  db.interviewAssignment = { findFirst: vi.fn().mockResolvedValue({ id: "a1" }) };
  vi.mocked(reassignInterviewer).mockResolvedValue({ reassigned: true } as any);
});

describe("POST /api/hiring/cycles/:cycleId/my-interviews/:interviewId/decline", () => {
  it("swaps the interviewer out and records the decline", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(reassignInterviewer).toHaveBeenCalledWith("iv1", "a1");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "interview.decline", targetId: "iv1" }),
    );
  });

  it("looks for the Active assignment under all of the member's interviewer rows", async () => {
    await call();
    expect(db.interviewAssignment.findFirst).toHaveBeenCalledWith({
      where: { interviewId: "iv1", cycleInterviewerId: { in: ["ci-1", "ci-2"] }, status: "Active" },
    });
  });

  it("409s and records nothing when no replacement is free", async () => {
    vi.mocked(reassignInterviewer).mockRejectedValue(new Error("none"));
    const res = await call();
    expect(res.status).toBe(409);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("404s when the member has no Active assignment on the interview", async () => {
    db.interviewAssignment.findFirst.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(reassignInterviewer).not.toHaveBeenCalled();
  });

  it("403s a member who isn't an interviewer on the cycle", async () => {
    db.cycleInterviewer.findMany.mockResolvedValue([]);
    const res = await call();
    expect(res.status).toBe(403);
  });
});
