import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/interview-meet", () => ({ deprovisionInterviewMeet: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/interview-emails", () => ({ sendInterviewCancelEmails: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/interview-notifications", () => ({ notifyInterviewCancelled: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/scheduling", () => ({ releaseInterviewRoom: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { sendInterviewCancelEmails } from "~/hiring/lib/interview-emails";
import { notifyInterviewCancelled } from "~/hiring/lib/interview-notifications";
import { releaseInterviewRoom } from "~/hiring/lib/scheduling";
import { action } from "~/hiring/routes/api.interviews.$id.cancel";

const tx: any = {
  interview: { update: vi.fn() },
  interviewAssignment: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
};
const db = prisma as any;

const interview = {
  id: "iv1",
  status: "Scheduled",
  applicationCycleId: "cyc1",
  domainApplicationId: "da1",
  startTime: new Date("2026-11-02T15:00:00Z"),
  calendarEventId: null,
  roomBookingId: "rb1",
  roomBooking: { userId: "u-interviewer" },
  assignments: [
    { cycleInterviewer: { userId: "u-in" } },
    { cycleInterviewer: { userId: "u-cross" } },
  ],
};

function post(body?: Record<string, unknown>) {
  return new Request("http://localhost/api/hiring/interviews/iv1/cancel", {
    method: "POST",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}
const call = (req: Request) => action({ request: req, params: { id: "iv1" } } as any);

beforeEach(() => {
  vi.clearAllMocks();
  db.interview = { findUnique: vi.fn().mockResolvedValue(interview) };
  db.$transaction = vi.fn(async (cb: any) => cb(tx));
  tx.interview.update.mockResolvedValue({ ...interview, status: "CancelledByAdmin" });
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u-core" } } as any);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("POST /api/hiring/interviews/:id/cancel", () => {
  it("cancels as admin, declines assignments, releases the room, and tells everyone", async () => {
    const res = await call(post());
    expect(res.status).toBe(200);
    expect(tx.interview.update).toHaveBeenCalledWith({ where: { id: "iv1" }, data: { status: "CancelledByAdmin" } });
    expect(tx.interviewAssignment.updateMany).toHaveBeenCalledWith({
      where: { interviewId: "iv1", status: "Active" },
      data: { status: "Declined" },
    });
    expect(releaseInterviewRoom).toHaveBeenCalledWith(interview, tx);
    expect(sendInterviewCancelEmails).toHaveBeenCalledWith("iv1", "da1", { byTeam: true, skipApplicant: false });
    expect(notifyInterviewCancelled).toHaveBeenCalledWith({
      interviewId: "iv1",
      interviewerUserIds: ["u-in", "u-cross"],
      createdByUserId: "u-core",
    });
  });

  it("skips the applicant email when notifyApplicant is false", async () => {
    await call(post({ notifyApplicant: false }));
    expect(sendInterviewCancelEmails).toHaveBeenCalledWith("iv1", "da1", { byTeam: true, skipApplicant: true });
  });

  it("403s a non-Core member, even an interviewer on the cycle", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await call(post());
    expect(res.status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("409s an interview that isn't scheduled", async () => {
    db.interview.findUnique.mockResolvedValue({ ...interview, status: "Completed" });
    const res = await call(post());
    expect(res.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("404s an unknown interview", async () => {
    db.interview.findUnique.mockResolvedValue(null);
    expect((await call(post())).status).toBe(404);
  });
});
