import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { staffingCycle: { findMany: vi.fn(), findUnique: vi.fn() } } }));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(), getUserRoles: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("../staffing-cycle", () => ({ ensureStaffingCycle: vi.fn() }));
vi.mock("../form-slots", () => ({ setSlotBuiltinColumn: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { ensureStaffingCycle } from "../staffing-cycle";
import { setSlotBuiltinColumn } from "../form-slots";
import { resolveBoardCycles, setBoardColumn } from "../slot-board.server";

const db = prisma as unknown as { staffingCycle: Record<string, ReturnType<typeof vi.fn>> };
const req = new Request("http://os.test/core/project-bids");
const terms = [
  { id: "t2", code: "26F", isCurrent: true },
  { id: "t1", code: "26X", isCurrent: false },
];
const filter = (over: Record<string, unknown> = {}) =>
  vi.mocked(resolveTermFilter).mockResolvedValue({
    terms,
    selected: "t2",
    termId: null,
    termIds: null,
    isAll: false,
    isUpcoming: false,
    ...over,
  } as never);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(currentTerm).mockResolvedValue({ id: "t2", code: "26F" } as never);
});

describe("resolveBoardCycles", () => {
  it("is null when there are no terms at all", async () => {
    filter({ terms: [] });
    vi.mocked(currentTerm).mockResolvedValue(null as never);
    expect(await resolveBoardCycles(req, { create: true })).toBeNull();
  });

  it("reads every cycle for all terms", async () => {
    filter({ isAll: true, selected: "all" });
    db.staffingCycle.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    expect(await resolveBoardCycles(req, { create: true })).toMatchObject({
      cycleIds: ["c1", "c2"],
      singleCycleId: null,
      cycleName: "all terms",
    });
  });

  it("creates the selected term's cycle for the board", async () => {
    filter({ termId: "t1", selected: "t1" });
    vi.mocked(ensureStaffingCycle).mockResolvedValue({ id: "c1", name: "26X staffing" } as never);
    expect(await resolveBoardCycles(req, { create: true })).toMatchObject({
      cycleIds: ["c1"],
      singleCycleId: "c1",
      cycleName: "26X staffing",
    });
    expect(ensureStaffingCycle).toHaveBeenCalledWith("t1", "26X");
  });

  it("never creates a cycle for a read-only caller, and reads nothing when there is none", async () => {
    filter();
    db.staffingCycle.findUnique.mockResolvedValue(null);
    expect(await resolveBoardCycles(req, { create: false })).toMatchObject({
      cycleIds: [],
      singleCycleId: null,
      cycleName: "26F",
    });
    expect(ensureStaffingCycle).not.toHaveBeenCalled();
    expect(db.staffingCycle.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { termId: "t2" } }));
  });
});

describe("setBoardColumn", () => {
  const body = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("refuses while the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const res = await setBoardColumn(body({ builtin: "termsInLab", shown: "1" }), "c1", "project-bids", "u1", req);
    expect(res.status).toBe(403);
    expect(setSlotBuiltinColumn).not.toHaveBeenCalled();
  });

  it("rejects a column that isn't a member column", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const res = await setBoardColumn(body({ builtin: "submitter", shown: "0" }), "c1", "project-bids", "u1", req);
    expect(res.status).toBe(400);
    expect(setSlotBuiltinColumn).not.toHaveBeenCalled();
  });

  it("shows or hides the column on the cycle's binding", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(setSlotBuiltinColumn).mockResolvedValue({ ok: true });
    const shown = await setBoardColumn(body({ builtin: "termsInLab", shown: "1" }), "c1", "level-up", "u1", req);
    expect(await shown.json()).toEqual({ ok: true });
    expect(setSlotBuiltinColumn).toHaveBeenCalledWith("c1", "level-up", "termsInLab", true, "u1");
    await setBoardColumn(body({ builtin: "termsInLab", shown: "0" }), "c1", "level-up", "u1", req);
    expect(setSlotBuiltinColumn).toHaveBeenLastCalledWith("c1", "level-up", "termsInLab", false, "u1");
  });

  it("passes back the setter's error", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(setSlotBuiltinColumn).mockResolvedValue({ ok: false, error: "Connect a form before adding columns." });
    const res = await setBoardColumn(body({ builtin: "hiredRoles", shown: "1" }), "c1", "project-bids", "u1", req);
    expect(res.status).toBe(400);
  });
});
