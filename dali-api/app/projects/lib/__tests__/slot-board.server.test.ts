import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { staffingCycle: { findMany: vi.fn(), findUnique: vi.fn() } } }));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(), getUserRoles: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("../staffing-cycle", () => ({ ensureStaffingCycle: vi.fn() }));
vi.mock("../form-slots", () => ({ applySlotColumnOp: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { ensureStaffingCycle } from "../staffing-cycle";
import { applySlotColumnOp } from "../form-slots";
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
  const body = (op: unknown) => {
    const f = new FormData();
    f.set("op", JSON.stringify(op));
    return f;
  };

  it("refuses while the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const res = await setBoardColumn(body({ op: "show", id: "builtin:termsInLab" }), "c1", "project-bids", "u1", req);
    expect(res.status).toBe(403);
    expect(applySlotColumnOp).not.toHaveBeenCalled();
  });

  it("rejects a malformed op", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const res = await setBoardColumn(body({ op: "drop", id: "q:a" }), "c1", "project-bids", "u1", req);
    expect(res.status).toBe(400);
    expect(applySlotColumnOp).not.toHaveBeenCalled();
  });

  it("applies the op to the cycle's binding", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(applySlotColumnOp).mockResolvedValue({ ok: true });
    const res = await setBoardColumn(body({ op: "move", id: "q:a", dir: 1 }), "c1", "level-up", "u1", req);
    expect(await res.json()).toEqual({ ok: true });
    expect(applySlotColumnOp).toHaveBeenCalledWith("c1", "level-up", { op: "move", id: "q:a", dir: 1 }, "u1");
  });

  it("passes back the reason an op can't apply", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(applySlotColumnOp).mockResolvedValue({ ok: false, error: "Unknown column." });
    const res = await setBoardColumn(body({ op: "hide", id: "q:gone" }), "c1", "project-bids", "u1", req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown column." });
  });
});
