import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
const currentTerm = vi.fn();
const syncAndRecomputeMembershipStatus = vi.fn();
const resolveMembershipStatus = vi.fn();
vi.mock("~/lib/roles", () => ({ currentTerm: (...a: unknown[]) => currentTerm(...a) }));
vi.mock("~/lib/membership-status.server", () => ({
  syncAndRecomputeMembershipStatus: (...a: unknown[]) => syncAndRecomputeMembershipStatus(...a),
  resolveMembershipStatus: (...a: unknown[]) => resolveMembershipStatus(...a),
  commencementDate: vi.fn(),
}));

import { mockedPrisma } from "~/test-utils/prisma";
import { runMembershipStatusSync } from "../membership-status-sync.server";

const db = mockedPrisma();
const TERM_START = new Date("2026-09-14T00:00:00Z");
const NOW = new Date(2026, 9, 5, 12, 0, 0);

const ctx = (settings: Record<string, number> = {}, now = NOW) => ({ now, lastSuccessAt: null, settings });
const candidateArgs = () => db.user.findMany.mock.calls[0][0] as { where: { OR: Record<string, unknown>[] }; take: number };
const member = (over: Record<string, unknown> = {}) => ({
  id: "u1",
  membershipStatus: "Active",
  membershipStatusComputedAt: new Date("2026-10-01"),
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  currentTerm.mockResolvedValue({ startDate: TERM_START });
  db.user.findMany.mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
  resolveMembershipStatus.mockReturnValue("Active");
  syncAndRecomputeMembershipStatus.mockResolvedValue(undefined);
});

describe("membership-status-sync candidates", () => {
  it("caps candidates at maxApiPerRun, defaulting to 200", async () => {
    await runMembershipStatusSync(ctx());
    expect(candidateArgs().take).toBe(200);

    vi.mocked(db.user.findMany).mockReset().mockResolvedValue([] as never);
    await runMembershipStatusSync(ctx({ maxApiPerRun: 25 }));
    expect(db.user.findMany.mock.calls[0][0]).toMatchObject({ take: 25 });
  });

  it("includes the term-rollover clause only when a term exists", async () => {
    await runMembershipStatusSync(ctx());
    expect(candidateArgs().where.OR).toContainEqual({ dartmouthPeopleSyncedAt: { lt: TERM_START } });

    vi.mocked(db.user.findMany).mockReset().mockResolvedValue([] as never);
    currentTerm.mockResolvedValue(null);
    await runMembershipStatusSync(ctx());
    const or = candidateArgs().where.OR;
    expect(or).toContainEqual({ dartmouthPeopleSyncedAt: null });
    expect(or.some((c) => JSON.stringify(c).includes('"lt"'))).toBe(false);
  });

  it("uses the previous class year as the cutoff before June 15", async () => {
    await runMembershipStatusSync(ctx({}, new Date(2026, 5, 14, 12)));
    expect(candidateArgs().where.OR).toContainEqual(
      expect.objectContaining({ membershipStatus: "Active", classYear: { lte: 2025 } }),
    );
  });

  it("uses the current class year as the cutoff from June 15", async () => {
    await runMembershipStatusSync(ctx({}, new Date(2026, 5, 15, 12)));
    expect(candidateArgs().where.OR).toContainEqual(
      expect.objectContaining({ membershipStatus: "Active", classYear: { lte: 2026 } }),
    );
  });

  it("includes the grad-program backfill clause", async () => {
    await runMembershipStatusSync(ctx());
    expect(candidateArgs().where.OR).toContainEqual({
      membershipStatus: "Alumni",
      dartmouthIsStudent: true,
      dartmouthDepartmentClass: null,
    });
  });

  it("force-syncs every candidate", async () => {
    db.user.findMany.mockReset().mockResolvedValueOnce([{ id: "a" }, { id: "b" }] as never).mockResolvedValueOnce([] as never);
    const result = await runMembershipStatusSync(ctx());
    expect(syncAndRecomputeMembershipStatus).toHaveBeenCalledWith("a", { force: true });
    expect(syncAndRecomputeMembershipStatus).toHaveBeenCalledWith("b", { force: true });
    expect(result.note).toBe("2 refreshed");
  });
});

describe("membership-status-sync recompute", () => {
  it("writes only when the status changed or was never computed", async () => {
    db.user.findMany
      .mockReset()
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        member({ id: "same" }),
        member({ id: "changed", membershipStatus: "Student" }),
        member({ id: "never", membershipStatusComputedAt: null }),
      ] as never);
    const result = await runMembershipStatusSync(ctx());
    expect(db.user.update).toHaveBeenCalledTimes(2);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "changed" },
      data: { membershipStatus: "Active", membershipStatusComputedAt: NOW },
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "never" },
      data: { membershipStatus: "Active", membershipStatusComputedAt: NOW },
    });
    expect(result.items).toBe(2);
  });

  it("joins refreshed and changed counts in the note", async () => {
    db.user.findMany
      .mockReset()
      .mockResolvedValueOnce([{ id: "a" }] as never)
      .mockResolvedValueOnce([member({ membershipStatusComputedAt: null })] as never);
    const result = await runMembershipStatusSync(ctx());
    expect(result).toEqual({ items: 1, note: "1 refreshed; 1 status change(s)" });
  });

  it("returns no note when there is nothing to report", async () => {
    const result = await runMembershipStatusSync(ctx());
    expect(result).toEqual({ items: 0, note: undefined });
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
