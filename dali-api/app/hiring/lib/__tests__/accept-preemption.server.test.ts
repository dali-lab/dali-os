import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { openSiblingDomains } from "~/hiring/lib/accept-preemption.server";

const mockDaFindUnique = prisma.domainApplication.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockDaFindMany = prisma.domainApplication.findMany as unknown as ReturnType<typeof vi.fn>;
const mockCycleFindUnique = prisma.applicationCycle.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockDacFindMany = prisma.domainApplicationCycle.findMany as unknown as ReturnType<typeof vi.fn>;

const DA_ID = "da-accepted";
const APPLICATION_ID = "app-1";
const CYCLE_ID = "cycle-1";
const NOW = new Date("2026-06-01T00:00:00Z");

function stubDa(overrides: Partial<{ applicationId: string; applicationCycleId: string }> = {}) {
  mockDaFindUnique.mockResolvedValue({
    applicationId: overrides.applicationId ?? APPLICATION_ID,
    application: { applicationCycleId: overrides.applicationCycleId ?? CYCLE_ID },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubDa();
  mockCycleFindUnique.mockResolvedValue({ closeDate: new Date("2026-07-01T00:00:00Z") });
  mockDaFindMany.mockResolvedValue([]);
  mockDacFindMany.mockResolvedValue([]);
});

describe("openSiblingDomains", () => {
  it("returns empty when the domain application doesn't exist", async () => {
    mockDaFindUnique.mockResolvedValue(null);
    expect(await openSiblingDomains(DA_ID, NOW)).toEqual([]);
    expect(mockCycleFindUnique).not.toHaveBeenCalled();
  });

  it("returns empty when the cycle can't be found", async () => {
    mockCycleFindUnique.mockResolvedValue(null);
    expect(await openSiblingDomains(DA_ID, NOW)).toEqual([]);
    expect(mockDaFindMany).not.toHaveBeenCalled();
  });

  it("returns empty when there are no siblings", async () => {
    mockDaFindMany.mockResolvedValue([]);
    expect(await openSiblingDomains(DA_ID, NOW)).toEqual([]);
    expect(mockDacFindMany).not.toHaveBeenCalled();
  });

  it("queries siblings excluding the decision's own DA, closed-out or released ones", async () => {
    await openSiblingDomains(DA_ID, NOW);
    expect(mockDaFindMany).toHaveBeenCalledWith({
      where: {
        applicationId: APPLICATION_ID,
        id: { not: DA_ID },
        selected: true,
        closureReason: null,
        decisions: { none: { stage: "Released" } },
      },
      select: {
        domainId: true,
        domain: { select: { name: true, displayName: true } },
      },
    });
  });

  it("includes a sibling whose domain close date hasn't passed, with that close date", async () => {
    mockDaFindMany.mockResolvedValue([
      { domainId: "d1", domain: { name: "fullstack", displayName: "Fullstack" } },
    ]);
    mockDacFindMany.mockResolvedValue([
      { domainId: "d1", closeDate: new Date("2026-07-15T00:00:00Z") },
    ]);
    const result = await openSiblingDomains(DA_ID, NOW);
    expect(result).toEqual([{ name: "Fullstack", closeDate: new Date("2026-07-15T00:00:00Z") }]);
  });

  it("excludes a sibling whose domain close date has already passed", async () => {
    mockDaFindMany.mockResolvedValue([
      { domainId: "d1", domain: { name: "fullstack", displayName: "Fullstack" } },
    ]);
    mockDacFindMany.mockResolvedValue([
      { domainId: "d1", closeDate: new Date("2026-05-01T00:00:00Z") },
    ]);
    expect(await openSiblingDomains(DA_ID, NOW)).toEqual([]);
  });

  it("falls back to the cycle's close date when the domain has no override", async () => {
    mockDaFindMany.mockResolvedValue([
      { domainId: "d1", domain: { name: "fullstack", displayName: "Fullstack" } },
    ]);
    mockDacFindMany.mockResolvedValue([{ domainId: "d1", closeDate: null }]);
    const result = await openSiblingDomains(DA_ID, NOW);
    expect(result).toEqual([{ name: "Fullstack", closeDate: new Date("2026-07-01T00:00:00Z") }]);
  });

  it("excludes a sibling once the cycle's own close date has passed and it has no override", async () => {
    mockCycleFindUnique.mockResolvedValue({ closeDate: new Date("2026-05-01T00:00:00Z") });
    mockDaFindMany.mockResolvedValue([
      { domainId: "d1", domain: { name: "fullstack", displayName: "Fullstack" } },
    ]);
    mockDacFindMany.mockResolvedValue([{ domainId: "d1", closeDate: null }]);
    expect(await openSiblingDomains(DA_ID, NOW)).toEqual([]);
  });

  it("treats a sibling missing from the dac query as having no override, defaulting to the cycle's close", async () => {
    mockDaFindMany.mockResolvedValue([
      { domainId: "d1", domain: { name: "fullstack", displayName: "Fullstack" } },
    ]);
    mockDacFindMany.mockResolvedValue([]);
    const result = await openSiblingDomains(DA_ID, NOW);
    expect(result).toEqual([{ name: "Fullstack", closeDate: new Date("2026-07-01T00:00:00Z") }]);
  });

  it("is open indefinitely (null closeDate) when neither the domain nor the cycle has one", async () => {
    mockCycleFindUnique.mockResolvedValue({ closeDate: null });
    mockDaFindMany.mockResolvedValue([
      { domainId: "d1", domain: { name: "fullstack", displayName: "Fullstack" } },
    ]);
    mockDacFindMany.mockResolvedValue([{ domainId: "d1", closeDate: null }]);
    const result = await openSiblingDomains(DA_ID, NOW);
    expect(result).toEqual([{ name: "Fullstack", closeDate: null }]);
  });

  it("falls back to the domain's bare name when it has no displayName", async () => {
    mockDaFindMany.mockResolvedValue([{ domainId: "d1", domain: { name: "fullstack", displayName: null } }]);
    mockDacFindMany.mockResolvedValue([{ domainId: "d1", closeDate: new Date("2026-07-15T00:00:00Z") }]);
    const result = await openSiblingDomains(DA_ID, NOW);
    expect(result).toEqual([{ name: "fullstack", closeDate: new Date("2026-07-15T00:00:00Z") }]);
  });

  it("returns only the still-open subset among several siblings", async () => {
    mockDaFindMany.mockResolvedValue([
      { domainId: "d1", domain: { name: "fullstack", displayName: "Fullstack" } },
      { domainId: "d2", domain: { name: "uiux", displayName: "UI/UX" } },
    ]);
    mockDacFindMany.mockResolvedValue([
      { domainId: "d1", closeDate: new Date("2026-05-01T00:00:00Z") }, // closed
      { domainId: "d2", closeDate: new Date("2026-07-20T00:00:00Z") }, // open
    ]);
    const result = await openSiblingDomains(DA_ID, NOW);
    expect(result).toEqual([{ name: "UI/UX", closeDate: new Date("2026-07-20T00:00:00Z") }]);
  });

  it("scopes the dac lookup to this cycle and these sibling domain ids", async () => {
    mockDaFindMany.mockResolvedValue([
      { domainId: "d1", domain: { name: "fullstack", displayName: "Fullstack" } },
      { domainId: "d2", domain: { name: "uiux", displayName: "UI/UX" } },
    ]);
    await openSiblingDomains(DA_ID, NOW);
    expect(mockDacFindMany).toHaveBeenCalledWith({
      where: { applicationCycleId: CYCLE_ID, domainId: { in: ["d1", "d2"] } },
      select: { domainId: true, closeDate: true },
    });
  });
});
