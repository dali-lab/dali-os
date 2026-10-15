import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocked at the getOpenCycles seam rather than at prisma: the status-resolution
// rules (latest update wins, Open-past-closeDate derives UnderReview, only Open
// counts) are covered by app/hiring/lib/__tests__/cycles.test.ts. What's under
// test here is the narrower public projection on top of it.
vi.mock("~/hiring/lib/cycles", () => ({ getOpenCycles: vi.fn() }));
vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { getOpenCycles } from "~/hiring/lib/cycles";
import {
  getPublicApplicationCycles,
  getPublicApplicationCycleResponse,
} from "~/public-api/lib/public-application-cycle.server";

const mockGetOpenCycles = getOpenCycles as unknown as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as Record<string, any>;

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

const CLOSED = { status: "closed", name: null, closeDate: null, domains: [] };

function domainRow(applicationCycleId: string, name: string, closeDate: Date | null) {
  return { applicationCycleId, closeDate, domain: { name } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOpenCycles.mockResolvedValue([]);
  mockPrisma.domainApplicationCycle = { findMany: vi.fn().mockResolvedValue([]) };
});

describe("getPublicApplicationCycles", () => {
  it("lists an Open cycle, its deadline the earliest ready domain's effective close", async () => {
    mockGetOpenCycles.mockResolvedValue([openCycle]);
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      domainRow("c1", "AI", null), // inherits the cycle's own close
    ]);

    expect(await getPublicApplicationCycles()).toEqual([
      {
        status: "open",
        name: "Fall 2026",
        closeDate: "2026-11-03T04:59:00.000Z",
        domains: [{ name: "AI", closeDate: "2026-11-03T04:59:00.000Z" }],
      },
    ]);
  });

  it("only ever asks for Students cycles", async () => {
    await getPublicApplicationCycles();
    expect(mockGetOpenCycles).toHaveBeenCalledWith({ applicants: "Students" });
  });

  it("queries only ready domains for the open cycles", async () => {
    mockGetOpenCycles.mockResolvedValue([openCycle]);
    await getPublicApplicationCycles();
    expect(mockPrisma.domainApplicationCycle.findMany).toHaveBeenCalledWith({
      where: { applicationCycleId: { in: ["c1"] }, isReady: true },
      select: { applicationCycleId: true, closeDate: true, domain: { select: { name: true } } },
    });
  });

  it("lists every open cycle, soonest cycle deadline first and no deadline last", async () => {
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

  it("deadline is null when the cycle has no ready domain at all", async () => {
    mockGetOpenCycles.mockResolvedValue([{ ...openCycle, closeDate: null }]);

    expect(await getPublicApplicationCycles()).toEqual([
      { status: "open", name: "Fall 2026", closeDate: null, domains: [] },
    ]);
  });

  it("deadline is the EARLIEST ready domain's close, not the latest, and domains list soonest first", async () => {
    mockGetOpenCycles.mockResolvedValue([{ ...openCycle, closeDate: null }]);
    const soon = new Date("2026-10-01T04:59:00.000Z");
    const late = new Date("2026-12-01T04:59:00.000Z");
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      domainRow("c1", "Late", late),
      domainRow("c1", "Soon", soon),
    ]);

    const [cycle] = await getPublicApplicationCycles();
    expect(cycle.closeDate).toBe(soon.toISOString());
    expect(cycle.domains).toEqual([
      { name: "Soon", closeDate: soon.toISOString() },
      { name: "Late", closeDate: late.toISOString() },
    ]);
  });

  it("a domain with no close date sorts last and shows null", async () => {
    mockGetOpenCycles.mockResolvedValue([{ ...openCycle, closeDate: null }]);
    const soon = new Date("2026-10-01T04:59:00.000Z");
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      domainRow("c1", "NoDate", null),
      domainRow("c1", "Soon", soon),
    ]);

    const [cycle] = await getPublicApplicationCycles();
    expect(cycle.domains).toEqual([
      { name: "Soon", closeDate: soon.toISOString() },
      { name: "NoDate", closeDate: null },
    ]);
  });
});

describe("getPublicApplicationCycleResponse", () => {
  it("is empty and closed when nothing is open", async () => {
    expect(await getPublicApplicationCycleResponse()).toEqual({ cycles: [], cycle: CLOSED });
  });

  // `cycle` is the pre-multi-cycle field, kept for one release so the site
  // doesn't break mid-deploy: it mirrors the soonest-closing open cycle (by
  // the CYCLE's own close, unaffected by the per-entry domain-driven deadline).
  it("keeps the single `cycle` field as the soonest-closing open cycle", async () => {
    mockGetOpenCycles.mockResolvedValue([
      { ...openCycle, id: "late", name: "Winter 2027", closeDate: new Date("2027-01-15T05:00:00.000Z") },
      openCycle,
    ]);
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([domainRow("c1", "AI", null)]);

    const res = await getPublicApplicationCycleResponse();
    expect(res.cycles).toHaveLength(2);
    expect(res.cycle).toEqual({
      status: "open",
      name: "Fall 2026",
      closeDate: "2026-11-03T04:59:00.000Z",
      domains: [{ name: "AI", closeDate: "2026-11-03T04:59:00.000Z" }],
    });
  });
});
