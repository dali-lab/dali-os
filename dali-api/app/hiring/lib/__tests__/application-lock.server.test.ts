import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  applicationLock,
  closedDomainIdSet,
  closedDomainIdsForCycle,
  frozenSelection,
} from "~/hiring/lib/application-lock.server";

const mockFindMany = prisma.domainApplicationCycle.findMany as unknown as ReturnType<typeof vi.fn>;

const CYCLE_ID = "cycle-1";
const NOW = new Date("2026-06-01T00:00:00Z");
const CYCLE_CLOSE = { closeDate: new Date("2026-07-01T00:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("closedDomainIdSet", () => {
  it("a domain with no closeDate inherits the cycle's and isn't closed before it", () => {
    const set = closedDomainIdSet([{ domainId: "d1", closeDate: null }], CYCLE_CLOSE, NOW);
    expect(set.has("d1")).toBe(false);
  });

  it("a domain with no closeDate is closed once the cycle's own close date has passed", () => {
    const set = closedDomainIdSet(
      [{ domainId: "d1", closeDate: null }],
      { closeDate: new Date("2026-05-01T00:00:00Z") },
      NOW,
    );
    expect(set.has("d1")).toBe(true);
  });

  it("a domain closeDate later than the cycle's stays open after the cycle closes", () => {
    const set = closedDomainIdSet(
      [{ domainId: "d1", closeDate: new Date("2026-07-15T00:00:00Z") }],
      { closeDate: new Date("2026-05-01T00:00:00Z") },
      NOW,
    );
    expect(set.has("d1")).toBe(false);
  });

  it("a domain closeDate earlier than the cycle's closes before the cycle does", () => {
    const set = closedDomainIdSet(
      [{ domainId: "d1", closeDate: new Date("2026-05-01T00:00:00Z") }],
      CYCLE_CLOSE,
      NOW,
    );
    expect(set.has("d1")).toBe(true);
  });

  it("no domains means nothing is closed", () => {
    expect(closedDomainIdSet([], CYCLE_CLOSE, NOW).size).toBe(0);
  });
});

describe("frozenSelection", () => {
  it("no selected DAs means nothing is frozen", () => {
    const { frozenDaIds, generalFrozen } = frozenSelection(new Set(["d1"]), []);
    expect(frozenDaIds.size).toBe(0);
    expect(generalFrozen).toBe(false);
  });

  it("a selected DA in a closed domain is frozen and freezes the general application", () => {
    const { frozenDaIds, generalFrozen } = frozenSelection(new Set(["d1"]), [
      { id: "da1", domainId: "d1" },
    ]);
    expect(frozenDaIds.has("da1")).toBe(true);
    expect(generalFrozen).toBe(true);
  });

  it("a selected DA in an open domain is not frozen", () => {
    const { frozenDaIds, generalFrozen } = frozenSelection(new Set(["d1"]), [
      { id: "da1", domainId: "d2" },
    ]);
    expect(frozenDaIds.size).toBe(0);
    expect(generalFrozen).toBe(false);
  });

  it("one closed selected domain among several open ones still freezes the general application", () => {
    const { frozenDaIds, generalFrozen } = frozenSelection(new Set(["d1"]), [
      { id: "da1", domainId: "d1" },
      { id: "da2", domainId: "d2" },
    ]);
    expect(frozenDaIds.has("da1")).toBe(true);
    expect(frozenDaIds.has("da2")).toBe(false);
    expect(generalFrozen).toBe(true);
  });
});

describe("closedDomainIdsForCycle", () => {
  it("queries only ready domains for the cycle", async () => {
    mockFindMany.mockResolvedValue([]);
    await closedDomainIdsForCycle(CYCLE_ID, CYCLE_CLOSE, NOW);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { applicationCycleId: CYCLE_ID, isReady: true },
      select: { domainId: true, closeDate: true },
    });
  });
});

describe("applicationLock", () => {
  it("reports no lock when no ready domain has closed", async () => {
    mockFindMany.mockResolvedValue([{ domainId: "d1", closeDate: null }]);
    const result = await applicationLock(CYCLE_ID, CYCLE_CLOSE, [], NOW);
    expect(result.closedDomainIds.size).toBe(0);
    expect(result.frozenDaIds.size).toBe(0);
    expect(result.generalFrozen).toBe(false);
  });

  it("locks a selected DA once its own domain close date has passed, even with no selected DAs otherwise", async () => {
    mockFindMany.mockResolvedValue([
      { domainId: "d1", closeDate: new Date("2026-05-01T00:00:00Z") },
      { domainId: "d2", closeDate: null },
    ]);
    const result = await applicationLock(
      CYCLE_ID,
      CYCLE_CLOSE,
      [{ id: "da1", domainId: "d1" }],
      NOW,
    );
    expect(result.closedDomainIds.has("d1")).toBe(true);
    expect(result.closedDomainIds.has("d2")).toBe(false);
    expect(result.frozenDaIds.has("da1")).toBe(true);
    expect(result.generalFrozen).toBe(true);
  });
});
