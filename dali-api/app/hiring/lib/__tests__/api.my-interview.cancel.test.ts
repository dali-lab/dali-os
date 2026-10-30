import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));
vi.mock("~/hiring/lib/interview-emails", () => ({
  getInterviewerRecipients: vi.fn(),
  sendInterviewCancelEmails: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/hiring/lib/interview-notifications", () => ({
  getActiveInterviewerUserIds: vi.fn().mockResolvedValue([]),
  notifyInterviewCancelled: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getInterviewerRecipients, sendInterviewCancelEmails } from "~/hiring/lib/interview-emails";
import { getActiveInterviewerUserIds, notifyInterviewCancelled } from "~/hiring/lib/interview-notifications";
import { action } from "~/hiring/routes/api.my-interview.cancel";

const mockTx: any = {
  interview: {
    update: vi.fn(),
  },
  interviewAssignment: {
    updateMany: vi.fn(),
  },
};

const mockPrisma = prisma as unknown as {
  interview: { findFirst: ReturnType<typeof vi.fn> };
  interviewConfig: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const USER_ID = "user-1";
const DA_ID_A = "da-design";
const DA_ID_B = "da-engineering";

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).interview = { findFirst: vi.fn() };
  (mockPrisma as any).interviewConfig = { findUnique: vi.fn().mockResolvedValue(null) };

  mockTx.interview.update = vi.fn();
  mockTx.interviewAssignment.updateMany = vi.fn().mockResolvedValue({ count: 0 });

  (mockPrisma as any).$transaction = vi.fn(async (cb: any) => cb(mockTx));

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID },
  } as any);
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/my-interview/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/hiring/my-interview/cancel", () => {
  it("returns 400 when domainApplicationId is missing", async () => {
    const res = await action({ request: makeRequest({}), params: {}, context: {} } as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details?.fieldErrors?.domainApplicationId).toBeTruthy();
  });

  it("scopes the query to the given domainApplicationId", async () => {
    mockPrisma.interview.findFirst.mockResolvedValue({
      id: "int-1",
      domainApplicationId: DA_ID_A,
      status: "Scheduled",
      startTime: new Date(Date.now() + 48 * 60 * 60_000),
      applicationCycleId: "cycle-1",
    });
    mockTx.interview.update.mockResolvedValue({
      id: "int-1",
      status: "CancelledByApplicant",
    });

    await action({
      request: makeRequest({ domainApplicationId: DA_ID_A }),
      params: {},
      context: {},
    } as any);

    expect(mockPrisma.interview.findFirst).toHaveBeenCalledWith({
      where: {
        domainApplicationId: DA_ID_A,
        domainApplication: { application: { userId: USER_ID } },
        status: "Scheduled",
      },
      include: { roomBooking: { select: { userId: true } } },
    });
  });

  it("cancels only the interview for the specified domain application", async () => {
    mockPrisma.interview.findFirst.mockResolvedValue({
      id: "int-design",
      domainApplicationId: DA_ID_A,
      status: "Scheduled",
      startTime: new Date(Date.now() + 48 * 60 * 60_000),
      applicationCycleId: "cycle-1",
    });
    mockTx.interview.update.mockResolvedValue({
      id: "int-design",
      status: "CancelledByApplicant",
    });

    const res = await action({
      request: makeRequest({ domainApplicationId: DA_ID_A }),
      params: {},
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockTx.interview.update).toHaveBeenCalledWith({
      where: { id: "int-design" },
      data: { status: "CancelledByApplicant" },
    });
  });

  it("flips all Active assignments for that interview to Declined", async () => {
    mockPrisma.interview.findFirst.mockResolvedValue({
      id: "int-design",
      domainApplicationId: DA_ID_A,
      status: "Scheduled",
      startTime: new Date(Date.now() + 48 * 60 * 60_000),
      applicationCycleId: "cycle-1",
    });
    mockTx.interview.update.mockResolvedValue({
      id: "int-design",
      status: "CancelledByApplicant",
    });
    mockTx.interviewAssignment.updateMany.mockResolvedValue({ count: 2 });

    await action({
      request: makeRequest({ domainApplicationId: DA_ID_A }),
      params: {},
      context: {},
    } as any);

    expect(mockTx.interviewAssignment.updateMany).toHaveBeenCalledWith({
      where: { interviewId: "int-design", status: "Active" },
      data: { status: "Declined" },
    });
  });

  it("emails the interviewers read before their assignments were declined", async () => {
    const interviewers = [{ email: "ada@example.edu", firstName: "Ada" }];
    vi.mocked(getInterviewerRecipients).mockResolvedValue(interviewers);
    mockPrisma.interview.findFirst.mockResolvedValue({
      id: "int-design",
      domainApplicationId: DA_ID_A,
      applicationCycleId: "cycle-1",
      interviewRoundId: "interviews",
      startTime: new Date("2027-01-01T10:00:00Z"),
      status: "Scheduled",
      calendarEventId: null,
      roomBookingId: null,
      roomBooking: null,
    });
    mockTx.interview.update.mockResolvedValue({ id: "int-design", status: "CancelledByApplicant" });

    await action({
      request: makeRequest({ domainApplicationId: DA_ID_A }),
      params: {},
      context: {},
    } as any);

    expect(getInterviewerRecipients).toHaveBeenCalledWith("int-design", mockTx);
    expect(vi.mocked(getInterviewerRecipients).mock.invocationCallOrder[0]).toBeLessThan(
      mockTx.interviewAssignment.updateMany.mock.invocationCallOrder[0],
    );
    expect(sendInterviewCancelEmails).toHaveBeenCalledWith("int-design", DA_ID_A, interviewers);
  });

  it("tells the interviewers in-app, with ids read before their assignments were declined", async () => {
    vi.mocked(getActiveInterviewerUserIds).mockResolvedValue(["u-ada", "u-grace"]);
    mockPrisma.interview.findFirst.mockResolvedValue({
      id: "int-design",
      domainApplicationId: DA_ID_A,
      applicationCycleId: "cycle-1",
      interviewRoundId: "interviews",
      startTime: new Date("2027-01-01T10:00:00Z"),
      status: "Scheduled",
      calendarEventId: null,
      roomBookingId: null,
      roomBooking: null,
    });
    mockTx.interview.update.mockResolvedValue({ id: "int-design", status: "CancelledByApplicant" });

    await action({
      request: makeRequest({ domainApplicationId: DA_ID_A }),
      params: {},
      context: {},
    } as any);

    expect(getActiveInterviewerUserIds).toHaveBeenCalledWith("int-design", mockTx);
    expect(vi.mocked(getActiveInterviewerUserIds).mock.invocationCallOrder[0]).toBeLessThan(
      mockTx.interviewAssignment.updateMany.mock.invocationCallOrder[0],
    );
    expect(notifyInterviewCancelled).toHaveBeenCalledWith({
      interviewId: "int-design",
      interviewerUserIds: ["u-ada", "u-grace"],
      reason: "applicant",
      createdByUserId: USER_ID,
    });
  });

  it("returns 404 when no scheduled interview exists for that DA", async () => {
    mockPrisma.interview.findFirst.mockResolvedValue(null);

    const res = await action({
      request: makeRequest({ domainApplicationId: DA_ID_B }),
      params: {},
      context: {},
    } as any);

    expect(res.status).toBe(404);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
