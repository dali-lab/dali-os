// getMyWorkData: reviews across every cycle on one board, per-cycle
// confidentiality gates, the interview cycle picker, and the reviewer queue's
// pipeline filter.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/hiring/lib/cycles", () => ({ getActiveCycles: vi.fn() }));
vi.mock("~/hiring/lib/confidentiality", async (importOriginal) => ({
  // Keep the pure access helpers real; only the DB-backed state is stubbed.
  ...(await importOriginal<typeof import("~/hiring/lib/confidentiality")>()),
  getCycleConfidentialityState: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { getActiveCycles } from "~/hiring/lib/cycles";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { getMyWorkData } from "~/hiring/lib/my-work.server";

const USER = "user-1";
const stages = { hasInitialDelibs: true, hasInterviews: true, anonymizeReview: false };
const STANDARD = { id: "cycle-std", name: "Students cycle", applicants: "Students", currentStatus: "Open", ...stages };
const FELLOWSHIP = { id: "cycle-fel", name: "Interns cycle", applicants: "Interns", currentStatus: "Open", ...stages };

const mockPrisma = prisma as unknown as Record<string, any>;

function req(search = ""): Request {
  return new Request(`http://localhost/hiring${search}`);
}

function bothCyclesActive() {
  vi.mocked(getActiveCycles).mockResolvedValue([STANDARD, FELLOWSHIP] as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  // "no_agreement" by default: it short-circuits the review
  // queries so picker tests don't need every downstream mock.
  vi.mocked(getCycleConfidentialityState).mockResolvedValue({
    status: "no_agreement",
    activeVersionId: null,
    exempt: false,
  });
  mockPrisma.cycleReviewer = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.cycleInterviewer = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.applicationReview = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.delibsSession = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.interviewConfig = { findUnique: vi.fn().mockResolvedValue(null) };
  mockPrisma.userCalendarLink = { findFirst: vi.fn().mockResolvedValue(null) };
  mockPrisma.workingHoursDay = { findFirst: vi.fn().mockResolvedValue(null) };
});

describe("getMyWorkData — which work shows", () => {
  it("has no work when no cycle is active", async () => {
    vi.mocked(getActiveCycles).mockResolvedValue([]);
    const res = await getMyWorkData(USER, req());
    expect(res.hasWork).toBe(false);
  });

  it("has no work when the user neither reviews nor interviews on an active cycle", async () => {
    bothCyclesActive();
    const res = await getMyWorkData(USER, req());
    expect(res.hasWork).toBe(false);
  });

  it("puts reviews from every cycle on one board, each tagged with its cycle", async () => {
    bothCyclesActive();
    vi.mocked(getCycleConfidentialityState).mockResolvedValue({
      status: "signed",
      activeVersionId: "v1",
      exempt: false,
    });
    mockPrisma.cycleReviewer.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve([{ id: `cr-${where.applicationCycleId}`, domainId: "dom-1" }]),
    );
    mockPrisma.applicationReview.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve([{ id: `rev-${where.cycleReviewerId.in[0]}`, domainApplication: { id: "da" } }]),
    );

    const res = await getMyWorkData(USER, req());

    expect(res.reviews?.multiCycle).toBe(true);
    expect(res.reviews?.myReviews.map((r: any) => [r.id, r.cycleName])).toEqual([
      ["rev-cr-cycle-std", STANDARD.name],
      ["rev-cr-cycle-fel", FELLOWSHIP.name],
    ]);
    expect(res.interviews).toBeNull();
  });

  it("gates an unsigned cycle by name while still loading the signed one", async () => {
    bothCyclesActive();
    vi.mocked(getCycleConfidentialityState).mockImplementation(async (_u, cycleId) =>
      cycleId === FELLOWSHIP.id
        ? { status: "unsigned", activeVersionId: "v1", exempt: false }
        : { status: "signed", activeVersionId: "v1", exempt: false },
    );
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ id: "cr-1", domainId: "dom-1" }]);

    const res = await getMyWorkData(USER, req());

    expect(res.reviews?.blocked).toEqual([
      { cycleId: FELLOWSHIP.id, cycleName: FELLOWSHIP.name, reason: "unsigned" },
    ]);
    // Only the signed cycle's queue is read.
    expect(mockPrisma.applicationReview.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("getMyWorkData — interviews", () => {
  const interviewsOnBoth = () =>
    mockPrisma.cycleInterviewer.findMany.mockResolvedValue([{ id: "ci-1" }]);

  it("shows interviews for a cycle the user only interviews on", async () => {
    bothCyclesActive();
    mockPrisma.cycleInterviewer.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(where.applicationCycleId === STANDARD.id ? [{ id: "ci-1" }] : []),
    );
    const res = await getMyWorkData(USER, req());
    expect(res.reviews).toBeNull();
    expect(res.interviews).toMatchObject({
      cycle: { id: STANDARD.id },
      cycles: [{ id: STANDARD.id, name: STANDARD.name }],
      // No linked calendar and no working hours: applicants can't book them.
      needsCalendar: true,
    });
  });

  it("doesn't prompt once a calendar is linked", async () => {
    bothCyclesActive();
    interviewsOnBoth();
    mockPrisma.userCalendarLink.findFirst.mockResolvedValue({ id: "link" });
    const res = await getMyWorkData(USER, req());
    expect(res.interviews?.needsCalendar).toBe(false);
  });

  it("defaults to the first (newest) cycle", async () => {
    bothCyclesActive();
    interviewsOnBoth();
    const res = await getMyWorkData(USER, req());
    expect(res.interviews?.cycle.id).toBe(STANDARD.id);
    expect(res.interviews?.cycles.map((c) => c.id)).toEqual([STANDARD.id, FELLOWSHIP.id]);
  });

  it("honors ?cycle=<id> when valid", async () => {
    bothCyclesActive();
    interviewsOnBoth();
    const res = await getMyWorkData(USER, req(`?cycle=${FELLOWSHIP.id}`));
    expect(res.interviews?.cycle.id).toBe(FELLOWSHIP.id);
  });

  it("falls back to the default when ?cycle=<id> isn't one the user interviews on", async () => {
    bothCyclesActive();
    interviewsOnBoth();
    const res = await getMyWorkData(USER, req("?cycle=bogus-id"));
    expect(res.interviews?.cycle.id).toBe(STANDARD.id);
  });
});

describe("getMyWorkData — reviewer queue", () => {
  it("queries ApplicationReview requiring Submitted and excluding Withdrawn on the parent application", async () => {
    vi.mocked(getActiveCycles).mockResolvedValue([STANDARD] as any);
    vi.mocked(getCycleConfidentialityState).mockResolvedValue({
      status: "signed",
      activeVersionId: "v1",
      exempt: false,
    });
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ id: "cr-1", domainId: "dom-1" }]);

    await getMyWorkData(USER, req());

    expect(mockPrisma.applicationReview.findMany).toHaveBeenCalledTimes(1);
    const where = mockPrisma.applicationReview.findMany.mock.calls[0][0].where;
    expect(where.cycleReviewerId).toEqual({ in: ["cr-1"] });
    expect(where.domainApplication.application.statusUpdates).toEqual({
      some: { newStatus: "Submitted" },
    });
    expect(where.domainApplication.application.NOT).toEqual({
      statusUpdates: { some: { newStatus: "Withdrawn" } },
    });
  });
});
