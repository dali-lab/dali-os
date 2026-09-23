import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { addDomainChallenge, removeDomainChallenge } from "~/hiring/lib/application-form.server";

const mockPrisma = prisma as unknown as Record<string, any>;
const status = (newStatus: string) =>
  mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus });

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.applicationCycleStatusUpdate = { findFirst: vi.fn() };
  // createDomainChallengeForm bails out early when the cycle isn't found.
  mockPrisma.applicationCycle = { findUnique: vi.fn().mockResolvedValue(null) };
  mockPrisma.domain = { findUnique: vi.fn().mockResolvedValue(null) };
  mockPrisma.cycleDomainForm = {
    findUnique: vi.fn().mockResolvedValue({ id: "cdf-1", applicationCycleId: "c1", formId: "f1" }),
    delete: vi.fn(),
  };
  mockPrisma.domainApplication = { count: vi.fn().mockResolvedValue(0) };
});

describe("addDomainChallenge", () => {
  it("creates the challenge in Draft", async () => {
    status("Draft");
    expect(await addDomainChallenge("c1", "d1", "u1")).toBeNull();
    expect(mockPrisma.applicationCycle.findUnique).toHaveBeenCalled();
  });

  it("refuses once the cycle has opened", async () => {
    status("Open");
    expect(await addDomainChallenge("c1", "d1", "u1")).toBe("not-draft");
    expect(mockPrisma.applicationCycle.findUnique).not.toHaveBeenCalled();
  });
});

describe("removeDomainChallenge", () => {
  it("unlinks an unpicked form in Draft", async () => {
    status("Draft");
    expect(await removeDomainChallenge("cdf-1", "c1")).toBeNull();
    expect(mockPrisma.cycleDomainForm.delete).toHaveBeenCalledWith({ where: { id: "cdf-1" } });
  });

  it("keeps a form an applicant already picked", async () => {
    status("Draft");
    mockPrisma.domainApplication.count.mockResolvedValue(2);
    expect(await removeDomainChallenge("cdf-1", "c1")).toBe("in-use");
    expect(mockPrisma.cycleDomainForm.delete).not.toHaveBeenCalled();
  });

  it("won't touch another cycle's link, or any link after opening", async () => {
    expect(await removeDomainChallenge("cdf-1", "other-cycle")).toBe("not-found");
    status("Open");
    expect(await removeDomainChallenge("cdf-1", "c1")).toBe("not-draft");
  });
});
