import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requireApiSignedOrForbidden: vi.fn().mockResolvedValue(null) }));
vi.mock("~/hiring/lib/scheduling", () => ({ freeUserIdsByInterview: vi.fn() }));
vi.mock("~/hiring/lib/interview-emails", () => ({ sendReassignmentEmails: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/interview-meet", () => ({ syncInterviewMeetAttendees: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/interview-notifications", () => ({ notifyInterviewAssigned: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { freeUserIdsByInterview } from "~/hiring/lib/scheduling";
import { action } from "~/hiring/routes/api.interviews.$id.reassign";

const mockPrisma = prisma as unknown as Record<string, any>;

const ASSIGNMENT_ID = "cm0000000000000000000a001";
const PM_SEATED = "cm0000000000000000000c001";
const PM_FREE = "cm0000000000000000000c002";
const DATA_FREE = "cm0000000000000000000c003";
const CROSS_SEATED = "cm0000000000000000000c004";
const CROSS_PM_ROW = "cm0000000000000000000c005";
const OFF_ROSTER = "cm0000000000000000000c006";

const roster = [
  { id: PM_SEATED, userId: "u-seated", domainId: "pm" },
  { id: PM_FREE, userId: "u-pm", domainId: "pm" },
  { id: DATA_FREE, userId: "u-data", domainId: "data" },
  { id: CROSS_SEATED, userId: "u-cross", domainId: "data" },
  { id: CROSS_PM_ROW, userId: "u-cross", domainId: "pm" },
];

const reassign = (newCycleInterviewerId: string) =>
  action({
    request: new Request("http://localhost/api/hiring/interviews/int1/reassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId: ASSIGNMENT_ID, newCycleInterviewerId }),
    }),
    params: { id: "int1" },
    context: {},
  } as any) as Promise<Response>;

let tx: { interviewConfig: any; interviewAssignment: any };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "lead" } } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(freeUserIdsByInterview).mockResolvedValue(
    new Map([["int1", ["u-pm", "u-data", "u-cross"]]]),
  );
  mockPrisma.interviewAssignment = {
    findUnique: vi.fn().mockResolvedValue({
      id: ASSIGNMENT_ID,
      role: "InDomain",
      cycleInterviewerId: PM_SEATED,
      interview: {
        id: "int1",
        applicationCycleId: "c1",
        interviewRoundId: "interviews",
        domainApplicationId: "da1",
        startTime: new Date("2027-01-04T15:00:00Z"),
        endTime: new Date("2027-01-04T15:30:00Z"),
        domainApplication: { domainId: "pm" },
      },
    }),
    findMany: vi.fn().mockResolvedValue([
      { cycleInterviewer: { userId: "u-seated" } },
      { cycleInterviewer: { userId: "u-cross" } },
    ]),
  };
  mockPrisma.cycleInterviewer = { findMany: vi.fn().mockResolvedValue(roster) };
  tx = {
    interviewConfig: { findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }) },
    interviewAssignment: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: "new-assignment" }),
    },
  };
  mockPrisma.$transaction = vi.fn(async (cb: any) => cb(tx));
});

describe("POST /api/hiring/interviews/:id/reassign", () => {
  it("swaps in an eligible interviewer who is free", async () => {
    const res = await reassign(PM_FREE);

    expect(res.status).toBe(200);
    expect(tx.interviewAssignment.update).toHaveBeenCalledWith({
      where: { id: ASSIGNMENT_ID },
      data: { status: "Replaced" },
    });
    expect(tx.interviewAssignment.create.mock.calls[0][0].data).toMatchObject({
      cycleInterviewerId: PM_FREE,
      role: "InDomain",
      status: "Active",
    });
  });

  it("rejects another domain's interviewer for the in-domain seat", async () => {
    const res = await reassign(DATA_FREE);

    expect(res.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects the applicant's domain for the cross-domain seat", async () => {
    mockPrisma.interviewAssignment.findUnique.mockResolvedValue({
      ...(await mockPrisma.interviewAssignment.findUnique()),
      role: "CrossDomain",
    });

    const res = await reassign(PM_FREE);

    expect(res.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a member already on the interview, even through their other domain row", async () => {
    const res = await reassign(CROSS_PM_ROW);

    expect(res.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an interviewer who isn't free, without changing any assignment", async () => {
    vi.mocked(freeUserIdsByInterview).mockResolvedValue(new Map([["int1", ["u-data"]]]));

    const res = await reassign(PM_FREE);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This interviewer isn't free at this time");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects when the round has no free-time data", async () => {
    vi.mocked(freeUserIdsByInterview).mockResolvedValue(new Map());

    const res = await reassign(PM_FREE);

    expect(res.status).toBe(409);
  });

  it("rejects someone outside this round's roster", async () => {
    const res = await reassign(OFF_ROSTER);

    expect(res.status).toBe(404);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("still catches an interview booked after the free check", async () => {
    tx.interviewAssignment.findFirst.mockResolvedValue({ id: "clash" });

    const res = await reassign(PM_FREE);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This interviewer is already assigned to another interview at this time");
    expect(tx.interviewAssignment.update).not.toHaveBeenCalled();
  });
});
