import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocked at the getActiveCycle seam rather than at prisma: the status-
// resolution rules (latest update wins, Open-past-closeDate derives
// UnderReview) are already covered by app/hiring/lib/__tests__/cycles.test.ts.
// What's under test here is the narrower public projection on top of it.
vi.mock("~/hiring/lib/cycles", () => ({ getActiveCycle: vi.fn() }));

import { getActiveCycle } from "~/hiring/lib/cycles";
import { getPublicApplicationCycle } from "~/public-api/lib/public-application-cycle.server";

const mockGetActiveCycle = getActiveCycle as unknown as ReturnType<typeof vi.fn>;

// 2026-11-03T04:59:00Z = 11:59 PM EDT on November 2. Deliberately a date whose
// UTC day differs from its Eastern day, so a timezone slip would show up.
const CLOSE_DATE = new Date("2026-11-03T04:59:00.000Z");

const openCycle = {
  id: "c1",
  name: "Fall 2026",
  closeDate: CLOSE_DATE,
  cycleType: "Standard",
  currentStatus: "Open",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveCycle.mockResolvedValue(null);
});

describe("getPublicApplicationCycle", () => {
  it("reports open, with the deadline in Eastern parts, for an Open cycle", async () => {
    mockGetActiveCycle.mockResolvedValue(openCycle);

    expect(await getPublicApplicationCycle()).toEqual({
      status: "open",
      name: "Fall 2026",
      closeDate: {
        day: 2,
        month: "November",
        year: 2026,
        time: "11:59 PM",
        fullDate: "2026-11-03T04:59:00.000Z",
      },
    });
  });

  it("only ever asks for Standard cycles", async () => {
    await getPublicApplicationCycle();
    expect(mockGetActiveCycle).toHaveBeenCalledWith("Standard");
  });

  it("reports closed when no cycle is active", async () => {
    mockGetActiveCycle.mockResolvedValue(null);

    expect(await getPublicApplicationCycle()).toEqual({
      status: "closed",
      name: null,
      closeDate: null,
    });
  });

  // The public contract's whole point: internally UnderReview is still an
  // "active" cycle, but submissions have closed, so the site must not invite
  // more of them.
  it("reports closed for a cycle under review", async () => {
    mockGetActiveCycle.mockResolvedValue({
      ...openCycle,
      currentStatus: "UnderReview",
    });

    const cycle = await getPublicApplicationCycle();
    expect(cycle.status).toBe("closed");
    expect(cycle.name).toBeNull();
  });

  // getActiveCycle derives UnderReview once an Open cycle passes its close
  // date, so the deadline is enforced without a second clock check here.
  it("reports closed once an Open cycle has passed its close date", async () => {
    mockGetActiveCycle.mockResolvedValue({
      ...openCycle,
      currentStatus: "UnderReview",
    });

    expect((await getPublicApplicationCycle()).status).toBe("closed");
  });

  it("reports open with a null deadline when the cycle has no close date", async () => {
    mockGetActiveCycle.mockResolvedValue({ ...openCycle, closeDate: null });

    expect(await getPublicApplicationCycle()).toEqual({
      status: "open",
      name: "Fall 2026",
      closeDate: null,
    });
  });

  // Fellowship/Core cycles are internal conversions with no public form.
  // getActiveCycle("Standard") filters them out upstream; this pins the
  // expectation that we never widen the query to pick them up.
  it("stays closed while only an internal cycle is running", async () => {
    mockGetActiveCycle.mockImplementation(async (type: string) =>
      type === "Fellowship" ? { ...openCycle, cycleType: "Fellowship" } : null,
    );

    expect((await getPublicApplicationCycle()).status).toBe("closed");
  });
});
