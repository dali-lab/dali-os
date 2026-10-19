import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/partners/lib/partner-notify.server", () => ({ notifyPartners: vi.fn() }));

import { prisma } from "~/lib/db";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import { runPartnerStaleSweep, isoWeekKey } from "~/jobs/partner-stale-sweep.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockNotifyPartners = notifyPartners as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-10-06T12:00:00Z");
const WEEK = isoWeekKey(NOW);

function app(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    title: "Acme Co",
    stage: "New",
    lastActivityAt: new Date("2026-09-01T00:00:00Z"), // well past 14 days
    holdUntil: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.partnerCrmSettings.findUnique.mockResolvedValue(null);
  mockPrisma.partnerApplication.findMany.mockResolvedValue([]);
  mockNotifyPartners.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 0 });
});

describe("isoWeekKey", () => {
  it("is stable within the same ISO week and changes across weeks", () => {
    expect(isoWeekKey(new Date("2026-10-05T00:00:00Z"))).toBe(isoWeekKey(new Date("2026-10-09T23:00:00Z")));
    expect(isoWeekKey(new Date("2026-10-05T00:00:00Z"))).not.toBe(
      isoWeekKey(new Date("2026-10-12T00:00:00Z")),
    );
  });
});

describe("runPartnerStaleSweep", () => {
  it("notifies once per card per ISO week, using PartnerCrmSettings.staleDays", async () => {
    mockPrisma.partnerCrmSettings.findUnique.mockResolvedValue({ id: "default", staleDays: 14 });
    mockPrisma.partnerApplication.findMany.mockResolvedValue([app()]);

    const result = await runPartnerStaleSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockNotifyPartners).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "partner.stale",
        link: "/core/partners?application=a1",
        dedupKey: `partner-stale:a1:${WEEK}`,
      }),
    );
    expect(result.items).toBe(1);
  });

  it("falls back to 14 days when no settings row exists", async () => {
    mockPrisma.partnerCrmSettings.findUnique.mockResolvedValue(null);
    mockPrisma.partnerApplication.findMany.mockResolvedValue([app()]);

    await runPartnerStaleSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockNotifyPartners).toHaveBeenCalledTimes(1);
  });

  it("skips a card whose last activity is within the stale window", async () => {
    mockPrisma.partnerCrmSettings.findUnique.mockResolvedValue({ id: "default", staleDays: 14 });
    mockPrisma.partnerApplication.findMany.mockResolvedValue([
      app({ lastActivityAt: new Date("2026-10-01T00:00:00Z") }), // 5 days ago
    ]);

    const result = await runPartnerStaleSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockNotifyPartners).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips a paused card even if stale", async () => {
    mockPrisma.partnerCrmSettings.findUnique.mockResolvedValue({ id: "default", staleDays: 14 });
    mockPrisma.partnerApplication.findMany.mockResolvedValue([
      app({ holdUntil: new Date("2026-12-01T00:00:00Z") }),
    ]);

    const result = await runPartnerStaleSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockNotifyPartners).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("queries only open, not-paused stages, bounded to the CAP", async () => {
    await runPartnerStaleSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.partnerApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stage: { in: ["New", "Interview"] },
          OR: [{ holdUntil: null }, { holdUntil: { lte: NOW } }],
        },
        take: 200,
      }),
    );
  });
});
