import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));
vi.mock("~/lib/dartmouth-timetable.server", () => ({ fetchTermCatalog: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { fetchTermCatalog } from "~/lib/dartmouth-timetable.server";
import { notify } from "~/lib/notify.server";
import { runTimetableSync } from "~/jobs/timetable-sync.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockTx = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockCurrentTerm = currentTerm as unknown as ReturnType<typeof vi.fn>;
const mockFetch = fetchTermCatalog as unknown as ReturnType<typeof vi.fn>;
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;

const ctx = (over: Partial<{ maxTermsPerRun: number; requestSpacingMs: number }> = {}) => ({
  now: new Date("2026-09-05T12:00:00Z"),
  lastSuccessAt: null,
  settings: { maxTermsPerRun: 6, requestSpacingMs: 0, ...over },
});

const course = (over: Partial<Record<string, unknown>> = {}) => ({
  term: "202609",
  crn: "91932",
  subject: "COSC",
  number: "52",
  section: "01",
  title: "Full-Stack Web Development",
  crosslist: "",
  periodCode: "2",
  periodText: "MWF 2:10-3:15, Th 1:20-2:10",
  room: "008",
  building: "Engineering & CS Center",
  instructor: "Tim Tregubov",
  worldCulture: "",
  distributive: "TAS",
  enrollLimit: 20,
  enrollCurrent: 20,
  status: "",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentTerm.mockResolvedValue({ id: "t-fall", code: "26F", sortKey: 20264 });
  mockPrisma.term.findMany.mockResolvedValue([{ id: "t-fall", code: "26F" }]);
  mockPrisma.courseOffering.groupBy.mockResolvedValue([]);
  mockPrisma.courseOffering.findMany.mockResolvedValue([]); // no prior sections → no change alerts
  mockPrisma.memberClass.findMany.mockResolvedValue([]);
  mockTx.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runTimetableSync", () => {
  it("replaces a term's catalog: deleteMany + createMany keyed on termId", async () => {
    mockFetch.mockResolvedValue([course()]);

    const result = await runTimetableSync(ctx());

    expect(mockFetch).toHaveBeenCalledWith("202609");
    expect(mockPrisma.courseOffering.deleteMany).toHaveBeenCalledWith({ where: { termId: "t-fall" } });
    const createArg = mockPrisma.courseOffering.createMany.mock.calls[0][0];
    expect(createArg.data).toHaveLength(1);
    expect(createArg.data[0]).toMatchObject({
      termId: "t-fall",
      oracleTerm: "202609",
      crn: "91932",
      number: "52",
      periodCode: "2",
      searchText: "cosc 52 full-stack web development",
    });
    expect(result.items).toBe(1);
  });

  it("dedupes cross-listed sections that share a CRN", async () => {
    mockFetch.mockResolvedValue([
      course({ subject: "COSC", crn: "555" }),
      course({ subject: "ENGS", crn: "555" }), // same CRN, cross-listed
      course({ subject: "MATH", crn: "777" }),
    ]);

    await runTimetableSync(ctx());

    const createArg = mockPrisma.courseOffering.createMany.mock.calls[0][0];
    expect(createArg.data).toHaveLength(2); // 555 collapsed to one row
  });

  it("respects the per-run term cap and reports the rest as deferred", async () => {
    mockPrisma.term.findMany.mockResolvedValue([
      { id: "t-fall", code: "26F" },
      { id: "t-winter", code: "27W" },
      { id: "t-spring", code: "27S" },
    ]);
    mockFetch.mockResolvedValue([course()]);

    const result = await runTimetableSync(ctx({ maxTermsPerRun: 2 }));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.note).toContain("1 deferred");
  });

  it("keeps existing rows when a term fetch returns nothing (format drift)", async () => {
    mockFetch.mockResolvedValue([]); // empty parse

    const result = await runTimetableSync(ctx());

    expect(mockTx).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
    expect(result.note).toContain("1 failed");
  });

  it("keeps going when one term's fetch throws", async () => {
    mockPrisma.term.findMany.mockResolvedValue([
      { id: "t-fall", code: "26F" },
      { id: "t-winter", code: "27W" },
    ]);
    mockFetch
      .mockRejectedValueOnce(new Error("oracle down"))
      .mockResolvedValueOnce([course({ term: "202701" })]);

    const result = await runTimetableSync(ctx());

    expect(result.items).toBe(1);
    expect(result.note).toContain("1 failed");
  });

  it("no-ops without a current term", async () => {
    mockCurrentTerm.mockResolvedValue(null);
    expect(await runTimetableSync(ctx())).toEqual({ items: 0, note: "no current term" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("alerts a member when their saved section's room/time changed", async () => {
    mockFetch.mockResolvedValue([course({ crn: "91932", periodCode: "2A", room: "007" })]);
    // prior sync had this section at period 2, room 008
    mockPrisma.courseOffering.findMany.mockResolvedValue([
      { crn: "91932", periodCode: "2", building: "Engineering & CS Center", room: "008" },
    ]);
    mockPrisma.memberClass.findMany.mockResolvedValue([
      { id: "mc1", userId: "u1", title: "COSC 52 — Full-Stack Web Development", offeringCrn: "91932" },
    ]);

    const result = await runTimetableSync(ctx());

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const arg = mockNotify.mock.calls[0][0];
    expect(arg.eventType).toBe("class.schedule_changed");
    expect(arg.recipients).toEqual([{ userId: "u1" }]);
    expect(arg.message.dedupKey).toBe("class-change:mc1:2A:Engineering & CS Center 007");
    expect(result.note).toContain("1 change alert");
  });

  it("does not alert when the section is unchanged", async () => {
    mockFetch.mockResolvedValue([
      course({ crn: "91932", periodCode: "2", building: "Engineering & CS Center", room: "008" }),
    ]);
    mockPrisma.courseOffering.findMany.mockResolvedValue([
      { crn: "91932", periodCode: "2", building: "Engineering & CS Center", room: "008" },
    ]);
    mockPrisma.memberClass.findMany.mockResolvedValue([
      { id: "mc1", userId: "u1", title: "COSC 52", offeringCrn: "91932" },
    ]);

    await runTimetableSync(ctx());
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
