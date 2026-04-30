import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  withAuth: <T,>(_auth: unknown, value: T) => value,
}));
vi.mock("~/hiring/lib/scheduling");
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { assignInterviewers } from "~/hiring/lib/scheduling";
import { action } from "~/hiring/routes/api.my-interview.reschedule";

const USER_ID = "user-1";
const DA_ID_A = "da-design";
const DA_ID_B = "da-engineering";
const CYCLE_ID = "cycle-1";

// Build a fake prisma.$transaction that runs the callback with a mock tx
const mockTx: any = {
  interview: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

const mockPrisma = prisma as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();

  mockTx.interview.findFirst = vi.fn();
  mockTx.interview.update = vi.fn();

  // $transaction receives (callback, options); invoke the callback with mockTx
  (mockPrisma as any).$transaction = vi.fn(async (cb: any) => cb(mockTx));

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID },
  } as any);

  vi.mocked(assignInterviewers).mockResolvedValue({ id: "new-int" } as any);
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/my-interview/reschedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/hiring/my-interview/reschedule", () => {
  it("returns 400 when domainApplicationId is missing", async () => {
    const res = await action({
      request: makeRequest({ newStart: "2026-01-01T10:00:00Z", newEnd: "2026-01-01T10:30:00Z" }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details?.fieldErrors?.domainApplicationId).toBeTruthy();
  });

  it("scopes the query to the given domainApplicationId", async () => {
    mockTx.interview.findFirst.mockResolvedValue({
      id: "int-1",
      applicationCycleId: CYCLE_ID,
      domainApplicationId: DA_ID_A,
      domainApplication: {
        application: {
          domainApplications: [
            { challengeVersion: { domainId: "domain-design" } },
            { challengeVersion: { domainId: "domain-eng" } },
          ],
        },
      },
    });
    mockTx.interview.update.mockResolvedValue({});

    await action({
      request: makeRequest({
        domainApplicationId: DA_ID_A,
        newStart: "2026-01-01T10:00:00Z",
        newEnd: "2026-01-01T10:30:00Z",
      }),
      params: {},
      context: {},
    } as any);

    expect(mockTx.interview.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          domainApplicationId: DA_ID_A,
          domainApplication: { application: { userId: USER_ID } },
          status: "Scheduled",
        }),
      }),
    );
  });

  it("cancels old interview and creates new one for the correct DA", async () => {
    mockTx.interview.findFirst.mockResolvedValue({
      id: "int-design",
      applicationCycleId: CYCLE_ID,
      domainApplicationId: DA_ID_A,
      domainApplication: {
        application: {
          domainApplications: [
            { challengeVersion: { domainId: "domain-design" } },
            { challengeVersion: { domainId: "domain-eng" } },
          ],
        },
      },
    });
    mockTx.interview.update.mockResolvedValue({});

    const res = await action({
      request: makeRequest({
        domainApplicationId: DA_ID_A,
        newStart: "2026-01-01T10:00:00Z",
        newEnd: "2026-01-01T10:30:00Z",
      }),
      params: {},
      context: {},
    } as any);

    expect(res.status).toBe(201);

    // Old interview cancelled
    expect(mockTx.interview.update).toHaveBeenCalledWith({
      where: { id: "int-design" },
      data: { status: "CancelledByApplicant" },
    });

    // New interview assigned to correct DA
    expect(assignInterviewers).toHaveBeenCalledWith(
      CYCLE_ID,
      DA_ID_A,
      ["domain-design", "domain-eng"],
      expect.any(Date),
      expect.any(Date),
      mockTx,
    );
  });

  it("returns 404 when no scheduled interview for that DA", async () => {
    mockTx.interview.findFirst.mockResolvedValue(null);

    const res = await action({
      request: makeRequest({
        domainApplicationId: DA_ID_B,
        newStart: "2026-01-01T10:00:00Z",
        newEnd: "2026-01-01T10:30:00Z",
      }),
      params: {},
      context: {},
    } as any);

    expect(res.status).toBe(404);
  });
});
