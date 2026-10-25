import { describe, expect, it } from "vitest";
import { bucketHours, estimateNeonProjectMonth, monthStart, NEON_RATES } from "../neon-cost";

const GB = 1_000_000_000;

describe("estimateNeonProjectMonth", () => {
  it("prices compute by CU-hour on Launch", () => {
    const est = estimateNeonProjectMonth({ compute_unit_seconds: 100 * 3600 }, "launch", 744)!;
    expect(est.lines.compute).toBeCloseTo(10.6);
  });

  it("prices compute by CU-hour on Scale", () => {
    const est = estimateNeonProjectMonth({ compute_unit_seconds: 100 * 3600 }, "scale", 744)!;
    expect(est.lines.compute).toBeCloseTo(22.2);
  });

  it("prices root and child storage together per decimal GB-month", () => {
    const est = estimateNeonProjectMonth(
      { root_branch_bytes_month: 2 * GB, child_branch_bytes_month: 1 * GB },
      "launch",
      744,
    )!;
    expect(est.lines.storage).toBeCloseTo(1.05);
  });

  it("prices restore history and snapshots at their own rates", () => {
    const est = estimateNeonProjectMonth(
      { instant_restore_bytes_month: 10 * GB, snapshot_storage_bytes_month: 10 * GB },
      "launch",
      744,
    )!;
    expect(est.lines.instantRestore).toBeCloseTo(2);
    expect(est.lines.snapshots).toBeCloseTo(0.9);
  });

  it("charges public egress only past the free 500 GB", () => {
    expect(estimateNeonProjectMonth({ public_network_transfer_bytes: 400 * GB }, "launch", 744)!.lines.publicTransfer).toBe(0);
    expect(estimateNeonProjectMonth({ public_network_transfer_bytes: 600 * GB }, "launch", 744)!.lines.publicTransfer).toBeCloseTo(10);
  });

  it("charges private egress on Scale but not Launch", () => {
    const m = { private_network_transfer_bytes: 100 * GB };
    expect(estimateNeonProjectMonth(m, "launch", 744)!.lines.privateTransfer).toBe(0);
    expect(estimateNeonProjectMonth(m, "scale", 744)!.lines.privateTransfer).toBeCloseTo(1);
  });

  it("subtracts the included child branches for the hours covered", () => {
    // Launch includes 9 child branches; 12 branches all month = 3 extra branch-months.
    const est = estimateNeonProjectMonth({ extra_branches_month: 12 * 744 }, "launch", 744)!;
    expect(est.lines.extraBranches).toBeCloseTo(4.5);
  });

  it("charges no extra branches within the allowance", () => {
    expect(estimateNeonProjectMonth({ extra_branches_month: 9 * 744 }, "launch", 744)!.lines.extraBranches).toBe(0);
  });

  it("scales the branch allowance to a partial month", () => {
    // 10 branches for 100 hours on Launch: one over the allowance for 100h.
    const est = estimateNeonProjectMonth({ extra_branches_month: 10 * 100 }, "launch", 100)!;
    expect(est.lines.extraBranches).toBeCloseTo((100 / 744) * 1.5);
  });

  it("totals every line", () => {
    const est = estimateNeonProjectMonth(
      { compute_unit_seconds: 10 * 3600, root_branch_bytes_month: GB },
      "launch",
      744,
    )!;
    expect(est.total).toBeCloseTo(1.06 + 0.35);
  });

  it("is zero on the free plan", () => {
    expect(estimateNeonProjectMonth({ compute_unit_seconds: 1e9 }, "free", 744)).toEqual({
      total: 0,
      lines: expect.objectContaining({ compute: 0 }),
    });
  });

  it("returns null for a plan without known rates", () => {
    expect(estimateNeonProjectMonth({ compute_unit_seconds: 3600 }, "enterprise", 744)).toBeNull();
    expect(estimateNeonProjectMonth({ compute_unit_seconds: 3600 }, null, 744)).toBeNull();
  });

  it("treats missing metrics as zero", () => {
    expect(estimateNeonProjectMonth({}, "launch", 744)!.total).toBe(0);
  });

  it("knows Launch and Scale", () => {
    expect(Object.keys(NEON_RATES).sort()).toEqual(["launch", "scale"]);
  });
});

describe("monthStart", () => {
  it("returns the UTC start of the month", () => {
    expect(monthStart(new Date("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("offsets across a year boundary", () => {
    expect(monthStart(new Date("2026-01-15T00:00:00Z"), -1).toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(monthStart(new Date("2026-12-15T00:00:00Z"), 1).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("bucketHours", () => {
  const oct = new Date("2026-10-01T00:00:00Z");

  it("counts elapsed hours in the current month", () => {
    expect(bucketHours(oct, new Date("2026-10-02T12:00:00Z"))).toBe(36);
  });

  it("counts the whole month once it has ended", () => {
    expect(bucketHours(oct, new Date("2026-11-20T00:00:00Z"))).toBe(31 * 24);
  });

  it("is zero for a month that hasn't started", () => {
    expect(bucketHours(new Date("2026-11-01T00:00:00Z"), new Date("2026-10-20T00:00:00Z"))).toBe(0);
  });
});
