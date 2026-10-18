import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/partners/lib/partner-notify.server", () => ({ notifyPartners: vi.fn() }));
vi.mock("~/partners/lib/partner-activity.server", () => ({ logPartnerActivity: vi.fn() }));

import { prisma } from "~/lib/db";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import { runPartnerRenewalSweep } from "~/jobs/partner-renewal-sweep.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockNotifyPartners = notifyPartners as unknown as ReturnType<typeof vi.fn>;
const mockLogActivity = logPartnerActivity as unknown as ReturnType<typeof vi.fn>;

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
  mockPrisma.projectPartner.findMany.mockResolvedValue([]);
  mockPrisma.partnerApplication.findFirst.mockResolvedValue(null);
  mockPrisma.partnerApplication.create.mockResolvedValue({ id: "newapp1" });
  mockPrisma.partnerOrg.findUnique.mockResolvedValue({
    name: "Acme Co",
    primaryContactId: null,
  });
  mockPrisma.partnerMembership.findUnique.mockResolvedValue(null);
  mockPrisma.partnerMembership.findFirst.mockResolvedValue({ contactId: "contact1" });
  mockLogActivity.mockResolvedValue(undefined);
  mockNotifyPartners.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 0 });
});

describe("runPartnerRenewalSweep", () => {
  it("creates a renewal application when the project's latest term ends within 30 days and the org has no open application", async () => {
    mockPrisma.projectPartner.findMany.mockResolvedValue([link()]);

    const result = await runPartnerRenewalSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.partnerApplication.create).toHaveBeenCalledWith({
      data: {
        applicantContactId: "contact1",
        partnerOrgId: "org1",
        source: "Renewal",
        stage: "New",
        title: "Renew: Project Alpha",
      },
      select: { id: true },
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        applicationId: "newapp1",
        type: "Created",
        metadata: { renewalOfProjectId: "proj1" },
      }),
    );
    expect(mockNotifyPartners).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "partner.renewal_due",
        link: "/core/partners?application=newapp1",
        dedupKey: "partner-renewal:pp1:term1",
      }),
    );
    expect(result.items).toBe(1);
  });

  it("prefers the org's primary-contact membership over the earliest one", async () => {
    mockPrisma.projectPartner.findMany.mockResolvedValue([link()]);
    mockPrisma.partnerOrg.findUnique.mockResolvedValue({
      name: "Acme Co",
      primaryContactId: "membership-primary",
    });
    mockPrisma.partnerMembership.findUnique.mockResolvedValue({ contactId: "primary-contact" });

    await runPartnerRenewalSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.partnerMembership.findUnique).toHaveBeenCalledWith({
      where: { id: "membership-primary" },
      select: { contactId: true },
    });
    expect(mockPrisma.partnerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ applicantContactId: "primary-contact" }) }),
    );
  });

  it("skips the org when it has no membership at all", async () => {
    mockPrisma.projectPartner.findMany.mockResolvedValue([link()]);
    mockPrisma.partnerMembership.findFirst.mockResolvedValue(null);

    const result = await runPartnerRenewalSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.partnerApplication.create).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips a link whose org already has an open application", async () => {
    mockPrisma.projectPartner.findMany.mockResolvedValue([link()]);
    mockPrisma.partnerApplication.findFirst.mockResolvedValue({ id: "existing" });

    const result = await runPartnerRenewalSweep({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.partnerApplication.create).not.toHaveBeenCalled();
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

    expect(mockPrisma.partnerApplication.create).not.toHaveBeenCalled();
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

    expect(mockPrisma.partnerApplication.create).not.toHaveBeenCalled();
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
