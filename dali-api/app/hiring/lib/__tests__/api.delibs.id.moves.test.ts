import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isDomainLead, hasCycleAccess } from "~/lib/roles";
import { action } from "~/hiring/routes/api.delibs.$id.moves";

const USER_ID = "user-1";
const SESSION_ID = "delibs-1";
const CYCLE_ID = "cycle-1";

const mockTx: any = {
  delibsSession: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

const mockPrisma = prisma as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
  delibsSession: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();

  mockTx.delibsSession.findUnique = vi.fn();
  mockTx.delibsSession.update = vi.fn();

  (mockPrisma as any).delibsSession = {
    findUnique: vi.fn().mockResolvedValue({ applicationCycleId: CYCLE_ID }),
  };

  // Run callback against mockTx; serialize concurrent transactions one at a
  // time so callers can simulate two in-flight moves observing fresh state.
  let chain: Promise<unknown> = Promise.resolve();
  (mockPrisma as any).$transaction = vi.fn((cb: any) => {
    const next = chain.then(() => cb(mockTx));
    chain = next.catch(() => {});
    return next;
  });

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID },
  } as any);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isDomainLead).mockResolvedValue(true);
  vi.mocked(hasCycleAccess).mockResolvedValue(true);
});

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/delibs/${SESSION_ID}/moves`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/hiring/delibs/:id/moves", () => {
  it("moves a card from its current column to the target column", async () => {
    mockTx.delibsSession.findUnique.mockResolvedValue({
      id: SESSION_ID,
      type: "Initial",
      status: "Open",
      columnOrder: {
        "No Decision": ["card-a", "card-b"],
        Interview: [],
        Reject: [],
      },
    });
    mockTx.delibsSession.update.mockImplementation(({ data }: any) => ({
      id: SESSION_ID,
      columnOrder: data.columnOrder,
    }));

    const res = await action({
      request: makeRequest({ cardId: "card-a", toColumn: "Interview" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.columnOrder).toEqual({
      "No Decision": ["card-b"],
      Interview: ["card-a"],
      Reject: [],
    });
  });

  it("inserts at the requested position when provided", async () => {
    mockTx.delibsSession.findUnique.mockResolvedValue({
      id: SESSION_ID,
      type: "Final",
      status: "Open",
      columnOrder: {
        Accept: ["a", "b", "c"],
        Waitlist: [],
        Reject: [],
      },
    });
    mockTx.delibsSession.update.mockImplementation(({ data }: any) => ({
      id: SESSION_ID,
      columnOrder: data.columnOrder,
    }));

    const res = await action({
      request: makeRequest({ cardId: "c", toColumn: "Accept", position: 0 }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.columnOrder.Accept).toEqual(["c", "a", "b"]);
  });

  it("concurrent moves of two different cards both land", async () => {
    // Server begins with both cards in "No Decision". Two reviewers each move
    // a different card concurrently. With a transactional read-modify-write,
    // both moves must end up in the final state.
    let stored: Record<string, string[]> = {
      "No Decision": ["card-a", "card-b"],
      Interview: [],
      Reject: [],
    };

    mockTx.delibsSession.findUnique.mockImplementation(async () => ({
      id: SESSION_ID,
      type: "Initial",
      status: "Open",
      columnOrder: stored,
    }));
    mockTx.delibsSession.update.mockImplementation(async ({ data }: any) => {
      stored = data.columnOrder;
      return { id: SESSION_ID, columnOrder: stored };
    });

    const [resA, resB] = await Promise.all([
      action({
        request: makeRequest({ cardId: "card-a", toColumn: "Interview" }),
        params: { id: SESSION_ID },
        context: {},
      } as any),
      action({
        request: makeRequest({ cardId: "card-b", toColumn: "Reject" }),
        params: { id: SESSION_ID },
        context: {},
      } as any),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(stored).toEqual({
      "No Decision": [],
      Interview: ["card-a"],
      Reject: ["card-b"],
    });
  });

  it("returns 403 when caller is neither hiring lead nor domain lead", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isDomainLead).mockResolvedValue(false);

    const res = await action({
      request: makeRequest({ cardId: "card-a", toColumn: "Interview" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 400 when toColumn is not valid for the session type", async () => {
    mockTx.delibsSession.findUnique.mockResolvedValue({
      id: SESSION_ID,
      type: "Initial",
      status: "Open",
      columnOrder: { "No Decision": ["card-a"], Interview: [], Reject: [] },
    });

    const res = await action({
      // "Accept" is a Final-stage column; invalid for an Initial session
      request: makeRequest({ cardId: "card-a", toColumn: "Accept" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(400);
    expect(mockTx.delibsSession.update).not.toHaveBeenCalled();
  });

  it("returns 400 when cardId is missing", async () => {
    const res = await action({
      request: makeRequest({ toColumn: "Interview" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the session does not exist", async () => {
    mockTx.delibsSession.findUnique.mockResolvedValue(null);

    const res = await action({
      request: makeRequest({ cardId: "card-a", toColumn: "Interview" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(404);
  });

  it("returns 409 when the session is closed", async () => {
    mockTx.delibsSession.findUnique.mockResolvedValue({
      id: SESSION_ID,
      type: "Initial",
      status: "Closed",
      columnOrder: { "No Decision": ["card-a"], Interview: [], Reject: [] },
    });

    const res = await action({
      request: makeRequest({ cardId: "card-a", toColumn: "Interview" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(409);
    expect(mockTx.delibsSession.update).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller has a lead role but no access to the session's cycle", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(hasCycleAccess).mockResolvedValue(false);

    const res = await action({
      request: makeRequest({ cardId: "card-a", toColumn: "Interview" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the pre-flight session lookup finds nothing", async () => {
    (mockPrisma as any).delibsSession.findUnique.mockResolvedValue(null);

    const res = await action({
      request: makeRequest({ cardId: "card-a", toColumn: "Interview" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(404);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("calls hasCycleAccess with the session's applicationCycleId before proceeding", async () => {
    mockTx.delibsSession.findUnique.mockResolvedValue({
      id: SESSION_ID,
      type: "Initial",
      status: "Open",
      columnOrder: {
        "No Decision": ["card-a"],
        Interview: [],
        Reject: [],
      },
    });
    mockTx.delibsSession.update.mockImplementation(({ data }: any) => ({
      id: SESSION_ID,
      columnOrder: data.columnOrder,
    }));

    const res = await action({
      request: makeRequest({ cardId: "card-a", toColumn: "Interview" }),
      params: { id: SESSION_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(hasCycleAccess).toHaveBeenCalledWith(USER_ID, CYCLE_ID);
  });
});
