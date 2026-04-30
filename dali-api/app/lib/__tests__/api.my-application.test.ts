import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  withAuth: <T,>(_auth: unknown, value: T) => value,
}));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));
vi.mock("~/lib/gmail", () => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/email", () => ({
  renderEmail: () => ({ subject: "", html: "" }),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { action } from "~/routes/api.my-application";

const mockPrisma = prisma as unknown as {
  applicationCycle: { findFirst: ReturnType<typeof vi.fn> };
  application: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  applicationStatusUpdate: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
  legacyEmailTemplate: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const USER_ID = "user-1";
const CYCLE_ID = "cycle-1";
const GENERAL_CV_ID = "cv-general";
const APP_ID = "app-1";

function openCycleResult() {
  return {
    id: CYCLE_ID,
    challengeVersions: [
      { challengeVersionId: GENERAL_CV_ID, challengeVersion: { domainId: null } },
      { challengeVersionId: "cv-design", challengeVersion: { domainId: "d-1" } },
    ],
    statusUpdates: [{ newStatus: "Open" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).applicationCycle = { findFirst: vi.fn() };
  (mockPrisma as any).application = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  };
  (mockPrisma as any).applicationStatusUpdate = {
    findFirst: vi.fn(),
    create: vi.fn().mockResolvedValue({}),
  };
  (mockPrisma as any).user = { findUnique: vi.fn().mockResolvedValue(null) };
  (mockPrisma as any).legacyEmailTemplate = { findFirst: vi.fn().mockResolvedValue(null) };
  (mockPrisma as any).$transaction = vi.fn(async (cb: any) =>
    cb(prisma as any),
  );
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "applicant" },
  } as any);
});

function makeRequest(body: Record<string, unknown> = { answers: {} }) {
  return new Request("http://localhost/api/my-application", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/my-application", () => {
  it("upserts on the (userId, applicationCycleId) composite key", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue(openCycleResult());
    mockPrisma.application.findUnique.mockResolvedValue(null);
    mockPrisma.application.upsert.mockResolvedValue({ id: APP_ID });
    mockPrisma.applicationStatusUpdate.findFirst.mockResolvedValue(null);

    const res = await action({
      request: makeRequest({ answers: { name: "Ada" } }),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(200);

    // Single upsert call — no findFirst-then-create branching.
    expect(mockPrisma.application.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = mockPrisma.application.upsert.mock.calls[0][0];
    expect(upsertCall.where).toEqual({
      userId_applicationCycleId: { userId: USER_ID, applicationCycleId: CYCLE_ID },
    });
    expect(upsertCall.create.generalChallengeVersionId).toBe(GENERAL_CV_ID);
    expect(upsertCall.create.answers).toEqual({ name: "Ada" });
    expect(upsertCall.update.answers).toEqual({ name: "Ada" });

    // First submission → status update fires.
    expect(mockPrisma.applicationStatusUpdate.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.applicationStatusUpdate.create).toHaveBeenCalledWith({
      data: { newStatus: "Submitted", applicationId: APP_ID, userId: USER_ID },
    });

    // Wrapped in a transaction so the upsert and status-update can't tear.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does not create a duplicate Submitted status update on resubmit", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue(openCycleResult());
    mockPrisma.application.findUnique.mockResolvedValue({
      id: APP_ID,
      statusUpdates: [{ newStatus: "Submitted" }],
    });
    mockPrisma.application.upsert.mockResolvedValue({ id: APP_ID });
    mockPrisma.applicationStatusUpdate.findFirst.mockResolvedValue({
      newStatus: "Submitted",
    });

    const res = await action({
      request: makeRequest({ answers: { name: "Ada" } }),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(200);
    expect(mockPrisma.application.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.applicationStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("returns 409 when the application is Withdrawn (sticky)", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue(openCycleResult());
    mockPrisma.application.findUnique.mockResolvedValue({
      id: APP_ID,
      statusUpdates: [{ newStatus: "Withdrawn" }],
    });

    const res = await action({
      request: makeRequest(),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(409);
    expect(mockPrisma.application.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.applicationStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("two concurrent submissions both go through upsert (same composite key)", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue(openCycleResult());
    mockPrisma.application.findUnique.mockResolvedValue(null);
    mockPrisma.application.upsert.mockResolvedValue({ id: APP_ID });

    // First call sees no prior status; second call (after the first commits)
    // sees Submitted, so it does not double-insert a status-update.
    mockPrisma.applicationStatusUpdate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ newStatus: "Submitted" });

    const [a, b] = await Promise.all([
      action({ request: makeRequest(), params: {}, context: {} } as any),
      action({ request: makeRequest(), params: {}, context: {} } as any),
    ]);

    expect((a as Response).status).toBe(200);
    expect((b as Response).status).toBe(200);

    // Both requests pass through the upsert — duplicate prevention is the
    // unique-key contract on the DB, not application-level branching.
    expect(mockPrisma.application.upsert).toHaveBeenCalledTimes(2);
    for (const call of mockPrisma.application.upsert.mock.calls) {
      expect(call[0].where).toEqual({
        userId_applicationCycleId: { userId: USER_ID, applicationCycleId: CYCLE_ID },
      });
    }

    // Exactly one Submitted status-update is created across the two requests.
    expect(mockPrisma.applicationStatusUpdate.create).toHaveBeenCalledTimes(1);
  });

  it("rejects when no active cycle exists", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue(null);

    const res = await action({
      request: makeRequest(),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(400);
    expect(mockPrisma.application.upsert).not.toHaveBeenCalled();
  });

  it("rejects when the cycle has no general challenge version", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue({
      ...openCycleResult(),
      challengeVersions: [
        { challengeVersionId: "cv-design", challengeVersion: { domainId: "d-1" } },
      ],
    });

    const res = await action({
      request: makeRequest(),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(400);
    expect(mockPrisma.application.upsert).not.toHaveBeenCalled();
  });

  it("rejects when applications are not Open for the cycle", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue({
      ...openCycleResult(),
      statusUpdates: [{ newStatus: "UnderReview" }],
    });

    const res = await action({
      request: makeRequest(),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(400);
    expect(mockPrisma.application.upsert).not.toHaveBeenCalled();
  });
});
