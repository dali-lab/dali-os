import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/hiring/lib/cycles");
vi.mock("~/lib/s3", () => ({
  getDownloadUrl: vi.fn(),
}));
vi.mock("~/hiring/lib/interview-emails", () => ({
  sendInterviewCancelEmails: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { sendInterviewCancelEmails } from "~/hiring/lib/interview-emails";
import { action } from "~/routes/portal.application";

const mockTx: any = {
  applicationStatusUpdate: { create: vi.fn() },
  interview: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  interviewAssignment: { updateMany: vi.fn() },
};

const mockPrisma = prisma as unknown as {
  application: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const USER_ID = "user-1";
const APP_ID = "app-1";
const CYCLE_ID = "cycle-1";

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).application = { findFirst: vi.fn() };

  mockTx.applicationStatusUpdate.create = vi.fn().mockResolvedValue({});
  mockTx.interview.findMany = vi.fn().mockResolvedValue([]);
  mockTx.interview.updateMany = vi.fn().mockResolvedValue({ count: 0 });
  mockTx.interviewAssignment.updateMany = vi.fn().mockResolvedValue({ count: 0 });

  (mockPrisma as any).$transaction = vi.fn(async (cb: any) => cb(mockTx));

  vi.mocked(getActiveCycle).mockResolvedValue({ id: CYCLE_ID, currentStatus: "Open" } as any);
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "applicant" },
  } as any);
});

function makeRequest(body: Record<string, string> = { intent: "withdraw" }) {
  const form = new URLSearchParams(body);
  return new Request("http://localhost/portal/application", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

describe("POST /portal/application (withdraw)", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as any);

    const res = await action({ request: makeRequest(), params: {}, context: {} } as any);
    expect(res.status).toBe(401);
  });

  it("returns 400 for unknown intent", async () => {
    const res = await action({
      request: makeRequest({ intent: "save" }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/intent/i);
  });

  it("returns 400 when there is no active cycle", async () => {
    vi.mocked(getActiveCycle).mockResolvedValueOnce(null);

    const res = await action({ request: makeRequest(), params: {}, context: {} } as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/cycle/i);
  });

  it("returns 404 when the user has no application for the active cycle", async () => {
    mockPrisma.application.findFirst.mockResolvedValue(null);

    const res = await action({ request: makeRequest(), params: {}, context: {} } as any);
    expect(res.status).toBe(404);
  });

  it("returns 400 when the application is still a Draft", async () => {
    mockPrisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      statusUpdates: [{ newStatus: "Draft" }],
    });

    const res = await action({ request: makeRequest(), params: {}, context: {} } as any);
    expect(res.status).toBe(400);
    expect(mockTx.applicationStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the application is already Withdrawn (idempotent guard)", async () => {
    mockPrisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      statusUpdates: [{ newStatus: "Withdrawn" }],
    });

    const res = await action({ request: makeRequest(), params: {}, context: {} } as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/withdrawn/i);
    expect(mockTx.applicationStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("creates exactly one Withdrawn status update with the caller's userId on success", async () => {
    mockPrisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      statusUpdates: [{ newStatus: "Submitted" }],
    });

    const res = await action({ request: makeRequest(), params: {}, context: {} } as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    expect(mockTx.applicationStatusUpdate.create).toHaveBeenCalledTimes(1);
    expect(mockTx.applicationStatusUpdate.create).toHaveBeenCalledWith({
      data: {
        applicationId: APP_ID,
        userId: USER_ID,
        newStatus: "Withdrawn",
      },
    });
  });

  it("cancels scheduled interviews and flips Active assignments to Declined", async () => {
    mockPrisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      statusUpdates: [{ newStatus: "Submitted" }],
    });
    mockTx.interview.findMany.mockResolvedValue([
      { id: "int-1", domainApplicationId: "da-1" },
      { id: "int-2", domainApplicationId: "da-2" },
    ]);

    const res = await action({ request: makeRequest(), params: {}, context: {} } as any);
    expect(res.status).toBe(200);

    expect(mockTx.interview.findMany).toHaveBeenCalledWith({
      where: {
        status: "Scheduled",
        applicationCycleId: CYCLE_ID,
        domainApplication: { applicationId: APP_ID },
      },
      select: { id: true, domainApplicationId: true },
    });
    expect(mockTx.interview.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["int-1", "int-2"] } },
      data: { status: "CancelledByApplicant" },
    });
    expect(mockTx.interviewAssignment.updateMany).toHaveBeenCalledWith({
      where: { interviewId: { in: ["int-1", "int-2"] }, status: "Active" },
      data: { status: "Declined" },
    });
    expect(sendInterviewCancelEmails).toHaveBeenCalledTimes(2);
    expect(sendInterviewCancelEmails).toHaveBeenCalledWith("int-1", "da-1");
    expect(sendInterviewCancelEmails).toHaveBeenCalledWith("int-2", "da-2");
  });

  it("skips interview cancellation work when no scheduled interviews exist", async () => {
    mockPrisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      statusUpdates: [{ newStatus: "Submitted" }],
    });
    mockTx.interview.findMany.mockResolvedValue([]);

    const res = await action({ request: makeRequest(), params: {}, context: {} } as any);
    expect(res.status).toBe(200);

    expect(mockTx.interview.updateMany).not.toHaveBeenCalled();
    expect(mockTx.interviewAssignment.updateMany).not.toHaveBeenCalled();
    expect(sendInterviewCancelEmails).not.toHaveBeenCalled();
  });
});
