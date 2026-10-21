import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  applicantDeadline,
  cycleCloseDate,
  cycleDeadlineSummary,
  domainCloseDate,
  domainReviewStatus,
  earliestCloseDate,
  isDomainClosed,
  latestCloseDate,
} from "~/hiring/lib/domain-windows";
import { canEditDomainSetup, domainGoLiveProblem, setDomainReady } from "~/hiring/lib/domain-windows.server";

const mockPrisma = prisma as unknown as Record<string, any>;
const status = (newStatus: string) =>
  mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus });

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.applicationCycleStatusUpdate = { findFirst: vi.fn() };
  mockPrisma.domainApplicationCycle = {
    findUnique: vi.fn().mockResolvedValue({ isReady: true }),
    upsert: vi.fn().mockResolvedValue({}),
  };
  mockPrisma.applicationCycle = { findUnique: vi.fn().mockResolvedValue({ hasChallenges: true }) };
  mockPrisma.cycleDomainForm = { count: vi.fn().mockResolvedValue(1) };
});

const OCT_30 = new Date("2026-10-30T23:59:00-04:00");
const NOV_13 = new Date("2026-11-13T23:59:00-05:00");
const cycle = { closeDate: OCT_30 };

describe("domainCloseDate / isDomainClosed", () => {
  it("inherits the cycle close when the domain has none", () => {
    expect(domainCloseDate({ closeDate: null }, cycle)).toEqual(OCT_30);
    expect(domainCloseDate({ closeDate: null }, { closeDate: null })).toBeNull();
  });

  it("prefers the domain's own close, accepting ISO strings", () => {
    expect(domainCloseDate({ closeDate: NOV_13.toISOString() }, cycle)).toEqual(NOV_13);
  });

  it("is closed only after its own effective close", () => {
    const nov1 = new Date("2026-11-01T12:00:00Z");
    expect(isDomainClosed({ closeDate: null }, cycle, nov1)).toBe(true);
    expect(isDomainClosed({ closeDate: NOV_13 }, cycle, nov1)).toBe(false);
    expect(isDomainClosed({ closeDate: null }, { closeDate: null }, nov1)).toBe(false);
  });

  it("latestCloseDate is the applicant's own deadline across selected domains", () => {
    expect(latestCloseDate([{ closeDate: null }, { closeDate: NOV_13 }], cycle)).toEqual(NOV_13);
    expect(latestCloseDate([{ closeDate: null }], cycle)).toEqual(OCT_30);
    expect(latestCloseDate([], cycle)).toBeNull();
  });

  it("earliestCloseDate is the conservative single date across every domain", () => {
    expect(earliestCloseDate([{ closeDate: null }, { closeDate: NOV_13 }], cycle)).toEqual(OCT_30);
    expect(earliestCloseDate([{ closeDate: NOV_13 }], cycle)).toEqual(NOV_13);
    expect(earliestCloseDate([], cycle)).toBeNull();
  });
});

describe("cycleCloseDate", () => {
  it("is the last ready domain's close when a domain closes after the cycle", () => {
    expect(cycleCloseDate([{ closeDate: null }, { closeDate: NOV_13 }], cycle)).toEqual(NOV_13);
  });

  it("is the cycle's own close when every domain inherits it", () => {
    expect(cycleCloseDate([{ closeDate: null }, { closeDate: null }], cycle)).toEqual(OCT_30);
  });

  it("is the latest domain close even when every domain closes before the cycle", () => {
    const oct20 = new Date("2026-10-20T23:59:00-04:00");
    expect(cycleCloseDate([{ closeDate: oct20 }], cycle)).toEqual(oct20);
  });

  it("falls back to the cycle's own close with no ready domains", () => {
    expect(cycleCloseDate([], cycle)).toEqual(OCT_30);
    expect(cycleCloseDate([], { closeDate: null })).toBeNull();
  });

  it("is null while any ready domain never closes", () => {
    expect(cycleCloseDate([{ closeDate: null }, { closeDate: NOV_13 }], { closeDate: null })).toBeNull();
  });
});

describe("domainReviewStatus", () => {
  const nov1 = new Date("2026-11-01T12:00:00Z");

  it("reads an Open cycle as UnderReview for a domain whose own window has closed", () => {
    expect(domainReviewStatus("Open", { closeDate: null }, cycle, nov1)).toBe("UnderReview");
  });

  it("keeps an Open cycle Open for a domain still taking applications", () => {
    expect(domainReviewStatus("Open", { closeDate: NOV_13 }, cycle, nov1)).toBe("Open");
  });

  it("keeps Open when neither the domain nor the cycle ever closes", () => {
    expect(domainReviewStatus("Open", { closeDate: null }, { closeDate: null }, nov1)).toBe("Open");
  });

  it.each(["Draft", "UnderReview", "Completed", null] as const)("passes %s through unchanged", (status) => {
    expect(domainReviewStatus(status, { closeDate: null }, cycle, nov1)).toBe(status);
  });
});

describe("cycleDeadlineSummary", () => {
  const SEP_1 = new Date("2026-09-01T12:00:00Z");
  const domains = [
    { domainId: "d1", closeDate: null },
    { domainId: "d2", closeDate: NOV_13 },
  ];

  it("with no selection, shows the latest close across every ready domain and flags the earlier one", () => {
    const { closeDate, earlierDomainsExist } = cycleDeadlineSummary(domains, cycle, null, SEP_1);
    expect(closeDate).toEqual(NOV_13);
    expect(earlierDomainsExist).toBe(true);
  });

  it("narrows to the applicant's selected domains when given a non-empty set", () => {
    const { closeDate, earlierDomainsExist } = cycleDeadlineSummary(domains, cycle, ["d1"], SEP_1);
    expect(closeDate).toEqual(OCT_30);
    // d2 (not selected) closes later than d1's shown deadline, so nothing closes earlier.
    expect(earlierDomainsExist).toBe(false);
  });

  it("falls back to every ready domain when the selection is empty", () => {
    const { closeDate } = cycleDeadlineSummary(domains, cycle, [], SEP_1);
    expect(closeDate).toEqual(NOV_13);
  });

  it("earlierDomainsExist is false when every ready domain shares the same close", () => {
    const { earlierDomainsExist } = cycleDeadlineSummary(
      [{ domainId: "d1", closeDate: null }, { domainId: "d2", closeDate: null }],
      cycle,
      null,
      SEP_1,
    );
    expect(earlierDomainsExist).toBe(false);
  });

  it("falls back to the cycle's own close, with nothing earlier, when there are no ready domains", () => {
    const { closeDate, earlierDomainsExist } = cycleDeadlineSummary([], cycle, null, SEP_1);
    expect(closeDate).toEqual(OCT_30);
    expect(earlierDomainsExist).toBe(false);
  });
  it("ignores domains that have already closed, both for the date and the earlier-close qualifier", () => {
    const nov1 = new Date("2026-11-01T12:00:00Z");
    // d1 inherited OCT_30 and has closed; only d2 is open.
    expect(cycleDeadlineSummary(domains, cycle, null, nov1)).toEqual({ closeDate: NOV_13, earlierDomainsExist: false });
    expect(cycleDeadlineSummary(domains, cycle, ["d1"], nov1)).toEqual({ closeDate: NOV_13, earlierDomainsExist: false });
  });
});

describe("applicantDeadline", () => {
  const domains = [
    { domainId: "uiux", closeDate: null },
    { domainId: "engs", closeDate: NOV_13 },
  ];
  const nov1 = new Date("2026-11-01T12:00:00Z");

  it("is the latest close among the applicant's selected domains while they're open", () => {
    expect(applicantDeadline(domains, cycle, ["uiux"], new Date("2026-10-01T12:00:00Z"))).toEqual(OCT_30);
  });

  it("falls to the open domains they could add once every selected domain has closed", () => {
    expect(applicantDeadline(domains, cycle, ["uiux"], nov1)).toEqual(NOV_13);
  });

  it("skips a closed selected domain when another selected domain is open", () => {
    expect(applicantDeadline(domains, cycle, ["uiux", "engs"], nov1)).toEqual(NOV_13);
  });

  it("is the latest open close with no selection", () => {
    expect(applicantDeadline(domains, cycle, null, nov1)).toEqual(NOV_13);
    expect(applicantDeadline(domains, cycle, [], nov1)).toEqual(NOV_13);
  });

  it("is null once every domain has closed", () => {
    expect(applicantDeadline(domains, cycle, ["engs"], new Date("2026-12-01T12:00:00Z"))).toBeNull();
  });

  it("is the cycle's own close with no ready domains", () => {
    expect(applicantDeadline([], cycle, ["engs"], nov1)).toEqual(OCT_30);
    expect(applicantDeadline([], { closeDate: null }, null, nov1)).toBeNull();
  });
});

describe("canEditDomainSetup", () => {
  it("is always editable in Draft", async () => {
    status("Draft");
    expect(await canEditDomainSetup("c1", "d1")).toBe(true);
    expect(mockPrisma.domainApplicationCycle.findUnique).not.toHaveBeenCalled();
  });

  it("in Open, only a staged (not ready) domain is editable", async () => {
    status("Open");
    expect(await canEditDomainSetup("c1", "d1")).toBe(false);
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue({ isReady: false });
    expect(await canEditDomainSetup("c1", "d1")).toBe(true);
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue(null);
    expect(await canEditDomainSetup("c1", "d1")).toBe(false);
  });

  it("is never editable from UnderReview on", async () => {
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue({ isReady: false });
    for (const s of ["UnderReview", "Completed"]) {
      status(s);
      expect(await canEditDomainSetup("c1", "d1")).toBe(false);
    }
  });
});

describe("domainGoLiveProblem", () => {
  it("needs a linked challenge form on a challenge cycle", async () => {
    mockPrisma.cycleDomainForm.count.mockResolvedValue(0);
    expect(await domainGoLiveProblem("c1", "d1")).toMatch(/challenge form/);
    expect(mockPrisma.cycleDomainForm.count).toHaveBeenCalledWith({
      where: { applicationCycleId: "c1", domainId: "d1" },
    });
  });

  it("passes with a form linked, or on a cycle without challenges", async () => {
    expect(await domainGoLiveProblem("c1", "d1")).toBeNull();
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ hasChallenges: false });
    mockPrisma.cycleDomainForm.count.mockResolvedValue(0);
    expect(await domainGoLiveProblem("c1", "d1")).toBeNull();
  });
});

describe("setDomainReady", () => {
  const upsertWith = (isReady: boolean) => ({
    where: { domainId_applicationCycleId: { domainId: "d1", applicationCycleId: "c1" } },
    update: { isReady },
    create: { domainId: "d1", applicationCycleId: "c1", isReady },
  });

  it("flips freely in Draft, without the go-live check", async () => {
    status("Draft");
    mockPrisma.cycleDomainForm.count.mockResolvedValue(0);
    expect(await setDomainReady("c1", "d1", true)).toBeNull();
    expect(await setDomainReady("c1", "d1", false)).toBeNull();
    expect(mockPrisma.domainApplicationCycle.upsert).toHaveBeenNthCalledWith(1, upsertWith(true));
    expect(mockPrisma.domainApplicationCycle.upsert).toHaveBeenNthCalledWith(2, upsertWith(false));
  });

  it("in Open, marking ready runs the go-live check first", async () => {
    status("Open");
    mockPrisma.cycleDomainForm.count.mockResolvedValue(0);
    expect(await setDomainReady("c1", "d1", true)).toMatch(/challenge form/);
    expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
    mockPrisma.cycleDomainForm.count.mockResolvedValue(1);
    expect(await setDomainReady("c1", "d1", true)).toBeNull();
    expect(mockPrisma.domainApplicationCycle.upsert).toHaveBeenCalledWith(upsertWith(true));
  });

  it("in Open, unmarking is refused", async () => {
    status("Open");
    expect(await setDomainReady("c1", "d1", false)).toMatch(/can't be unmarked/);
    expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
  });

  it("is refused from UnderReview on", async () => {
    status("UnderReview");
    expect(await setDomainReady("c1", "d1", true)).toMatch(/Draft or Open/);
    expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
  });
});
