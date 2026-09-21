import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocked at the getOpenCycles seam rather than at prisma: the status-resolution
// rules (latest update wins, Open-past-closeDate derives UnderReview, only Open
// counts) are covered by app/hiring/lib/__tests__/cycles.test.ts. What's under
// test here is the narrower public projection on top of it.
vi.mock("~/hiring/lib/cycles", () => ({ getOpenCycles: vi.fn() }));

import { getOpenCycles } from "~/hiring/lib/cycles";
import {
  getPublicApplicationCycles,
  getPublicApplicationCycleResponse,
} from "~/public-api/lib/public-application-cycle.server";

const mockGetOpenCycles = getOpenCycles as unknown as ReturnType<typeof vi.fn>;

// 2026-11-03T04:59:00Z = 11:59 PM EDT on November 2. Deliberately a date whose
// UTC day differs from its Eastern day, so a timezone slip would show up.
const CLOSE_DATE = new Date("2026-11-03T04:59:00.000Z");

const openCycle = {
  id: "c1",
  name: "Fall 2026",
  closeDate: CLOSE_DATE,
  applicants: "Students",
  currentStatus: "Open",
};

const CLOSED = { status: "closed", name: null, closeDate: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOpenCycles.mockResolvedValue([]);
});

describe("getPublicApplicationCycles", () => {
  it("lists an Open cycle with its deadline as an ISO timestamp", async () => {
    mockGetOpenCycles.mockResolvedValue([openCycle]);

    expect(await getPublicApplicationCycles()).toEqual([
      { status: "open", name: "Fall 2026", closeDate: "2026-11-03T04:59:00.000Z" },
    ]);
  });

  // Interns and Lab members cycles are for people already in the lab, with no
  // public form; the query must never widen to pick them up.
  it("only ever asks for Students cycles", async () => {
    await getPublicApplicationCycles();
    expect(mockGetOpenCycles).toHaveBeenCalledWith({ applicants: "Students" });
  });

  it("lists every open cycle, soonest deadline first and no deadline last", async () => {
    mockGetOpenCycles.mockResolvedValue([
      { ...openCycle, id: "none", name: "No date", closeDate: null },
      { ...openCycle, id: "late", name: "Winter 2027", closeDate: new Date("2027-01-15T05:00:00.000Z") },
      { ...openCycle, id: "soon", name: "Fall 2026" },
    ]);

    expect((await getPublicApplicationCycles()).map((c) => c.name)).toEqual([
      "Fall 2026",
      "Winter 2027",
      "No date",
    ]);
  });

  it("reports an open cycle with a null deadline when it has no close date", async () => {
    mockGetOpenCycles.mockResolvedValue([{ ...openCycle, closeDate: null }]);

    expect(await getPublicApplicationCycles()).toEqual([
      { status: "open", name: "Fall 2026", closeDate: null },
    ]);
  });
});

describe("getPublicApplicationCycleResponse", () => {
  it("is empty and closed when nothing is open", async () => {
    expect(await getPublicApplicationCycleResponse()).toEqual({ cycles: [], cycle: CLOSED });
  });

  // `cycle` is the pre-multi-cycle field, kept for one release so the site
  // doesn't break mid-deploy: it mirrors the soonest-closing open cycle.
  it("keeps the single `cycle` field as the soonest-closing open cycle", async () => {
    mockGetOpenCycles.mockResolvedValue([
      { ...openCycle, id: "late", name: "Winter 2027", closeDate: new Date("2027-01-15T05:00:00.000Z") },
      openCycle,
    ]);

    const res = await getPublicApplicationCycleResponse();
    expect(res.cycles).toHaveLength(2);
    expect(res.cycle).toEqual({
      status: "open",
      name: "Fall 2026",
      closeDate: "2026-11-03T04:59:00.000Z",
    });
  });
});
