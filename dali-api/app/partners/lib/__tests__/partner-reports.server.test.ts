import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  resolveReportsTerm,
  loadFunnelSection,
  loadRejectionReasonsSection,
  loadRevenueSection,
} from "../partner-reports.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveReportsTerm", () => {
  const terms = [
    { id: "t-27f", code: "27F" },
    { id: "t-26s", code: "26S" },
  ];

  beforeEach(() => {
    mockPrisma.term = {
      findMany: vi.fn().mockResolvedValue(terms),
      findFirst: vi.fn(),
    };
  });

  it("returns All time when termParam is 'all'", async () => {
    const result = await resolveReportsTerm("all");
    expect(result.selectedTermId).toBeNull();
    expect(result.terms).toEqual(terms);
  });

  it("selects the given term id when it exists", async () => {
    const result = await resolveReportsTerm("t-26s");
    expect(result.selectedTermId).toBe("t-26s");
    expect(result.selectedTermCode).toBe("26S");
  });

  it("falls back to the current term when termParam is unknown", async () => {
    mockPrisma.term.findFirst.mockResolvedValueOnce({ id: "t-27f", code: "27F" });
    const result = await resolveReportsTerm("bogus-id");
    expect(result.selectedTermId).toBe("t-27f");
  });

  it("falls back to All time when there is no current or upcoming term", async () => {
    mockPrisma.term.findFirst.mockResolvedValue(null);
    const result = await resolveReportsTerm(null);
    expect(result.selectedTermId).toBeNull();
  });
});

describe("loadFunnelSection", () => {
  it("scopes applications by term and only keeps recognized StatusChanged targets", async () => {
    mockPrisma.partnerApplication = {
      findMany: vi.fn().mockResolvedValue([
        { id: "a1", stage: "Interview", source: "Form", title: "Alpha", partnerOrg: { name: "Acme" }, applicantContact: null },
        { id: "a2", stage: "Rejected", source: "Email", title: "Beta", partnerOrg: null, applicantContact: { name: "Jo" } },
      ]),
    };
    mockPrisma.partnerActivity = {
      findMany: vi.fn().mockResolvedValue([
        { applicationId: "a1", metadata: { to: "Interview" } },
        { applicationId: "a2", metadata: { to: "Interview" } },
        { applicationId: "a2", metadata: { to: "Rejected" } },
        { applicationId: "a2", metadata: { note: "no 'to' field" } },
      ]),
    };

    const result = await loadFunnelSection("term-1");

    expect(mockPrisma.partnerApplication.findMany).toHaveBeenCalledWith({
      where: { targetTerms: { some: { termId: "term-1" } } },
      select: {
        id: true,
        stage: true,
        source: true,
        title: true,
        partnerOrg: { select: { name: true } },
        applicantContact: { select: { name: true } },
      },
    });
    expect(result.funnel.total).toBe(2);
    // a2 ever reached Interview before being Rejected.
    expect(result.funnel.newToInterviewRate).toBe(1);
    expect(result.reached.interview).toEqual(["a1", "a2"]);
    expect(result.applications).toEqual([
      { id: "a1", title: "Alpha", orgName: "Acme", stage: "Interview" },
      { id: "a2", title: "Beta", orgName: "Jo", stage: "Rejected" },
    ]);
    expect(result.bySource).toEqual([
      { source: "Form", count: 1 },
      { source: "Email", count: 1 },
    ]);
  });

  it("skips the activity query when there are no applications in scope", async () => {
    mockPrisma.partnerApplication = { findMany: vi.fn().mockResolvedValue([]) };
    mockPrisma.partnerActivity = { findMany: vi.fn() };

    const result = await loadFunnelSection(null);

    expect(mockPrisma.partnerActivity.findMany).not.toHaveBeenCalled();
    expect(result.funnel.total).toBe(0);
  });
});

describe("loadFunnelSection with Deciding", () => {
  it("keeps Deciding status changes so the application counts as interviewed", async () => {
    mockPrisma.partnerApplication = {
      findMany: vi.fn().mockResolvedValue([
        { id: "a1", stage: "Rejected", source: "Form", title: "A", partnerOrg: null, applicantContact: null },
      ]),
    };
    mockPrisma.partnerActivity = {
      findMany: vi.fn().mockResolvedValue([
        { applicationId: "a1", metadata: { to: "Deciding" } },
        { applicationId: "a1", metadata: { to: "Rejected" } },
      ]),
    };

    const result = await loadFunnelSection(null);

    expect(result.reached.interview).toEqual(["a1"]);
    expect(result.funnel.newToInterviewRate).toBe(1);
  });
});

describe("loadRejectionReasonsSection", () => {
  it("returns the ids behind each reason", async () => {
    mockPrisma.partnerApplication = {
      findMany: vi.fn().mockResolvedValue([
        { id: "a1", rejectReason: "Timing" },
        { id: "a2", rejectReason: "Timing" },
      ]),
    };

    const result = await loadRejectionReasonsSection("term-1");

    expect(mockPrisma.partnerApplication.findMany).toHaveBeenCalledWith({
      where: { stage: "Rejected", targetTerms: { some: { termId: "term-1" } } },
      select: { id: true, rejectReason: true },
    });
    expect(result).toEqual([{ reason: "Timing", count: 2, ids: ["a1", "a2"] }]);
  });
});

describe("loadRevenueSection", () => {
  it("filters to Paid/Issued and sums per org", async () => {
    mockPrisma.term = { findUnique: vi.fn().mockResolvedValue(null) };
    mockPrisma.partnerInvoice = {
      findMany: vi.fn().mockResolvedValue([
        { orgId: "o1", amountCents: 1000, status: "Paid", org: { name: "Acme" } },
        { orgId: "o1", amountCents: 500, status: "Issued", org: { name: "Acme" } },
      ]),
    };

    const result = await loadRevenueSection(null);

    expect(result).toEqual([{ orgId: "o1", orgName: "Acme", totalCents: 1500 }]);
  });

  it("scopes to the term's date window when a term is selected", async () => {
    mockPrisma.term = {
      findUnique: vi.fn().mockResolvedValue({
        startDate: new Date("2026-09-01"),
        endDate: new Date("2026-12-01"),
      }),
    };
    mockPrisma.partnerInvoice = { findMany: vi.fn().mockResolvedValue([]) };

    await loadRevenueSection("term-1");

    expect(mockPrisma.partnerInvoice.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["Paid", "Issued"] },
        issuedAt: { gte: new Date("2026-09-01"), lte: new Date("2026-12-01") },
      },
      select: {
        orgId: true,
        amountCents: true,
        status: true,
        org: { select: { name: true } },
      },
    });
  });
});
