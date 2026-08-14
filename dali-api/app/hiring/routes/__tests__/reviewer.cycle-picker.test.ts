// Focused tests for the cycle-picker logic in /hiring/reviewer's loader.
// Mocks past the picker and short-circuits via confidentialityRequired so we
// don't have to stand up every downstream query.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/hiring/lib/cycles", () => ({
  getActiveCycle: vi.fn(),
  cycleStatusToStage: vi.fn().mockReturnValue("review"),
  inferUnderReviewStage: vi.fn(),
}));
vi.mock("~/hiring/lib/confidentiality", () => ({
  // Short-circuit the loader before the heavy downstream queries.
  getCycleConfidentialityState: vi.fn().mockResolvedValue({ status: "no_agreement" }),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { loader } from "~/hiring/routes/reviewer";

const USER = "user-1";
const STANDARD = { id: "cycle-std", name: "Standard cycle", cycleType: "Standard", currentStatus: "Open" };
const INTERN = { id: "cycle-itf", name: "Intern → Full conversion", cycleType: "Fellowship", currentStatus: "Open" };

const mockPrisma = prisma as unknown as Record<string, any>;

function reqWith(search: string): Request {
  return new Request(`http://localhost/hiring/reviewer${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER } } as any);
  mockPrisma.dALIMember = {
    findUnique: vi.fn().mockResolvedValue({ id: "member-1", userId: USER }),
  };
  mockPrisma.cycleReviewer = { findMany: vi.fn() };
  mockPrisma.cycleInterviewer = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
  };
  mockPrisma.applicationReview = { findMany: vi.fn().mockResolvedValue([]) };
});

describe("/hiring/reviewer loader — cycle picker", () => {
  it("empty when no active cycles exist", async () => {
    vi.mocked(getActiveCycle).mockResolvedValue(null as any);
    const res: any = await loader({ request: reqWith(""), params: {}, context: {} } as any);
    expect(res.activeCycle).toBeNull();
    expect(res.availableCycles).toEqual([]);
  });

  it("empty when active cycles exist but user has no CycleReviewer rows on any", async () => {
    vi.mocked(getActiveCycle)
      .mockResolvedValueOnce(STANDARD as any)
      .mockResolvedValueOnce(INTERN as any);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([]);
    const res: any = await loader({ request: reqWith(""), params: {}, context: {} } as any);
    expect(res.activeCycle).toBeNull();
    expect(res.availableCycles).toEqual([]);
  });

  it("picks the only cycle the reviewer is on; availableCycles has just that one", async () => {
    vi.mocked(getActiveCycle)
      .mockResolvedValueOnce(STANDARD as any)
      .mockResolvedValueOnce(INTERN as any);
    mockPrisma.cycleReviewer.findMany.mockImplementation(({ where }: any) =>
      where.applicationCycleId === INTERN.id
        ? Promise.resolve([{ id: "cr-1", domainId: "dom-1" }])
        : Promise.resolve([]),
    );
    const res: any = await loader({ request: reqWith(""), params: {}, context: {} } as any);
    expect(res.activeCycle.id).toBe(INTERN.id);
    expect(res.availableCycles).toEqual([
      { id: INTERN.id, name: INTERN.name, cycleType: "Fellowship" },
    ]);
  });

  it("prefers Standard when reviewer is on both and no ?cycle param given", async () => {
    vi.mocked(getActiveCycle)
      .mockResolvedValueOnce(STANDARD as any)
      .mockResolvedValueOnce(INTERN as any);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ id: "cr-1", domainId: "dom-1" }]);
    const res: any = await loader({ request: reqWith(""), params: {}, context: {} } as any);
    expect(res.activeCycle.id).toBe(STANDARD.id);
    expect(res.availableCycles.map((c: any) => c.id)).toEqual([STANDARD.id, INTERN.id]);
  });

  it("honors ?cycle=<id> when valid", async () => {
    vi.mocked(getActiveCycle)
      .mockResolvedValueOnce(STANDARD as any)
      .mockResolvedValueOnce(INTERN as any);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ id: "cr-1", domainId: "dom-1" }]);
    const res: any = await loader({
      request: reqWith(`?cycle=${INTERN.id}`),
      params: {},
      context: {},
    } as any);
    expect(res.activeCycle.id).toBe(INTERN.id);
  });

  it("falls back to default when ?cycle=<id> doesn't match any cycle the reviewer is on", async () => {
    vi.mocked(getActiveCycle)
      .mockResolvedValueOnce(STANDARD as any)
      .mockResolvedValueOnce(INTERN as any);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ id: "cr-1", domainId: "dom-1" }]);
    const res: any = await loader({
      request: reqWith("?cycle=bogus-id"),
      params: {},
      context: {},
    } as any);
    expect(res.activeCycle.id).toBe(STANDARD.id);
  });
});
