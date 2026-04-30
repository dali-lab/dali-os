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

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { action } from "~/routes/api.my-interview.cancel";

const mockPrisma = prisma as unknown as {
  interview: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const USER_ID = "user-1";
const DA_ID_A = "da-design";
const DA_ID_B = "da-engineering";

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).interview = {
    findFirst: vi.fn(),
    update: vi.fn(),
  };
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

describe("POST /api/my-interview/cancel", () => {
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
    });
    mockPrisma.interview.update.mockResolvedValue({
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
    });
  });

  it("cancels only the interview for the specified domain application", async () => {
    mockPrisma.interview.findFirst.mockResolvedValue({
      id: "int-design",
      domainApplicationId: DA_ID_A,
      status: "Scheduled",
    });
    mockPrisma.interview.update.mockResolvedValue({
      id: "int-design",
      status: "CancelledByApplicant",
    });

    const res = await action({
      request: makeRequest({ domainApplicationId: DA_ID_A }),
      params: {},
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockPrisma.interview.update).toHaveBeenCalledWith({
      where: { id: "int-design" },
      data: { status: "CancelledByApplicant" },
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
  });
});
