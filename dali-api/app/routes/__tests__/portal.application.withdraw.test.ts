import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  withAuth: <T,>(_auth: unknown, value: T) => value,
}));
vi.mock("~/lib/cycles");
vi.mock("~/lib/s3", () => ({
  getDownloadUrl: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/lib/cycles";
import { action } from "~/routes/portal.application";

const mockPrisma = prisma as unknown as {
  application: { findFirst: ReturnType<typeof vi.fn> };
  applicationStatusUpdate: { create: ReturnType<typeof vi.fn> };
};

const USER_ID = "user-1";
const APP_ID = "app-1";
const CYCLE_ID = "cycle-1";

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).application = { findFirst: vi.fn() };
  (mockPrisma as any).applicationStatusUpdate = { create: vi.fn() };
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
    expect(mockPrisma.applicationStatusUpdate.create).not.toHaveBeenCalled();
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
    expect(mockPrisma.applicationStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("creates exactly one Withdrawn status update with the caller's userId on success", async () => {
    mockPrisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      statusUpdates: [{ newStatus: "Submitted" }],
    });
    mockPrisma.applicationStatusUpdate.create.mockResolvedValue({
      id: "update-1",
      newStatus: "Withdrawn",
      applicationId: APP_ID,
      userId: USER_ID,
    });

    const res = await action({ request: makeRequest(), params: {}, context: {} } as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    expect(mockPrisma.applicationStatusUpdate.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.applicationStatusUpdate.create).toHaveBeenCalledWith({
      data: {
        applicationId: APP_ID,
        userId: USER_ID,
        newStatus: "Withdrawn",
      },
    });
  });
});
