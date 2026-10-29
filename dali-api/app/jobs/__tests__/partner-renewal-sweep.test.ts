import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/partners/lib/partner-notify.server", () => ({ notifyPartners: vi.fn() }));

import { prisma } from "~/lib/db";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import { runPartnerRenewalSweep } from "~/jobs/partner-renewal-sweep.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockNotifyPartners = notifyPartners as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-10-06T12:00:00Z");

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: "pp1",
    partnerOrgId: "org1",
    project: {
      id: "proj1",
      name: "Project Alpha",
      projectTerms: [
        {
          term: {
            id: "term1",
            sortKey: 262,
            endDate: new Date("2026-10-20T00:00:00Z"), // within 30 days
          },
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.projectTermStatus ??= { findFirst: vi.fn() };
  mockPrisma.term.findFirst.mockResolvedValue({ id: "term2" });
  mockPrisma.projectTermStatus.findFirst.mockResolvedValue(null);
  mockPrisma.projectPartner.findMany.mockResolvedValue([]);
  mockPrisma.partnerOrg.findUnique.mockResolvedValue({ name: "Acme Co" });
  mockNotifyPartners.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 0 });
});

describe("runPartnerRenewalSweep", () => {
  it("sends a reminder linked to Renewals when the latest term ends within 30 days and no decision exists", async () => {
    mockPrisma.projectPartner.findMany.mockResolvedValue([link()]);

    const result = await runPartnerRenewalSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockNotifyPartners).toHaveBeenCalledWith({
      eventType: "partner.renewal_due",
      title: "Renewal decision due: Project Alpha",
      body: "Acme Co's project ends Oct 20. Decide in Renewals.",
      link: "/core/partners/renewals",
      dedupKey: "partner-renewal:pp1:term1",
    });
    expect(result.items).toBe(1);
  });

  it("creates no application", async () => {
    mockPrisma.projectPartner.findMany.mockResolvedValue([link()]);

    await runPartnerRenewalSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.partnerApplication.create).not.toHaveBeenCalled();
  });

  it("skips a project that already has a decision for the following term", async () => {
    mockPrisma.projectPartner.findMany.mockResolvedValue([link()]);
    mockPrisma.projectTermStatus.findFirst.mockResolvedValue({ id: "status1" });

    const result = await runPartnerRenewalSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.projectTermStatus.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "proj1", termId: "term2" } }),
    );
    expect(mockNotifyPartners).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips a project whose latest term ends beyond the 30-day horizon", async () => {
    mockPrisma.projectPartner.findMany.mockResolvedValue([
      link({
        project: {
          id: "proj1",
          name: "Project Alpha",
          projectTerms: [
            { term: { id: "term1", sortKey: 262, endDate: new Date("2027-01-01T00:00:00Z") } },
          ],
        },
      }),
    ]);

    const result = await runPartnerRenewalSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockNotifyPartners).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips a project whose latest term already ended", async () => {
    mockPrisma.projectPartner.findMany.mockResolvedValue([
      link({
        project: {
          id: "proj1",
          name: "Project Alpha",
          projectTerms: [
            { term: { id: "term1", sortKey: 262, endDate: new Date("2026-01-01T00:00:00Z") } },
          ],
        },
      }),
    ]);

    const result = await runPartnerRenewalSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockNotifyPartners).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("picks the latest-sortKey term when a project has several planned terms", async () => {
    mockPrisma.projectPartner.findMany.mockResolvedValue([
      link({
        project: {
          id: "proj1",
          name: "Project Alpha",
          projectTerms: [
            { term: { id: "term-old", sortKey: 251, endDate: new Date("2026-01-01T00:00:00Z") } },
            { term: { id: "term-new", sortKey: 262, endDate: new Date("2026-10-20T00:00:00Z") } },
          ],
        },
      }),
    ]);

    await runPartnerRenewalSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockNotifyPartners).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: "partner-renewal:pp1:term-new" }),
    );
  });
});
