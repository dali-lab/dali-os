import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { action } from "~/routes/domain-lead";

const USER_ID = "user-1";
const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "domain-1";
const CV_ID = "cv-1";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.applicationCycleStatusUpdate = { findFirst: vi.fn() };
  mockPrisma.challengeVersion = { findUnique: vi.fn() };
  mockPrisma.challengeVersionApplicationCycle = {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  mockPrisma.domainApplication = { count: vi.fn().mockResolvedValue(0) };

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "lead@x.com", type: "user" },
  } as any);
});

function makeRequest(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return new Request("http://localhost/domain-lead", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

function callAction(form: Record<string, string>) {
  return action({ request: makeRequest(form), params: {}, context: {} } as any);
}

describe("domain-lead action — add-challenge", () => {
  it("links a new challenge version without deleting siblings", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
    mockPrisma.challengeVersion.findUnique.mockResolvedValue({ id: CV_ID, domainId: DOMAIN_ID });

    await callAction({
      intent: "add-challenge",
      cycleId: CYCLE_ID,
      challengeVersionId: CV_ID,
      domainId: DOMAIN_ID,
    });

    expect(mockPrisma.challengeVersionApplicationCycle.create).toHaveBeenCalledWith({
      data: { challengeVersionId: CV_ID, applicationCycleId: CYCLE_ID },
    });
    expect(mockPrisma.challengeVersionApplicationCycle.deleteMany).not.toHaveBeenCalled();
  });

  it("is idempotent — skips create when already linked", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
    mockPrisma.challengeVersion.findUnique.mockResolvedValue({ id: CV_ID, domainId: DOMAIN_ID });
    mockPrisma.challengeVersionApplicationCycle.findUnique.mockResolvedValue({
      challengeVersionId: CV_ID,
      applicationCycleId: CYCLE_ID,
    });

    await callAction({
      intent: "add-challenge",
      cycleId: CYCLE_ID,
      challengeVersionId: CV_ID,
      domainId: DOMAIN_ID,
    });

    expect(mockPrisma.challengeVersionApplicationCycle.create).not.toHaveBeenCalled();
  });

  it("is a no-op when cycle is past Draft", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });

    await callAction({
      intent: "add-challenge",
      cycleId: CYCLE_ID,
      challengeVersionId: CV_ID,
      domainId: DOMAIN_ID,
    });

    expect(mockPrisma.challengeVersionApplicationCycle.create).not.toHaveBeenCalled();
  });

  it("rejects a CV whose domain does not match", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
    mockPrisma.challengeVersion.findUnique.mockResolvedValue({ id: CV_ID, domainId: "other-domain" });

    await callAction({
      intent: "add-challenge",
      cycleId: CYCLE_ID,
      challengeVersionId: CV_ID,
      domainId: DOMAIN_ID,
    });

    expect(mockPrisma.challengeVersionApplicationCycle.create).not.toHaveBeenCalled();
  });
});

describe("domain-lead action — remove-challenge", () => {
  it("unlinks a CV in Draft when no DomainApplication picked it", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
    mockPrisma.domainApplication.count.mockResolvedValue(0);

    await callAction({
      intent: "remove-challenge",
      cycleId: CYCLE_ID,
      challengeVersionId: CV_ID,
    });

    expect(mockPrisma.challengeVersionApplicationCycle.deleteMany).toHaveBeenCalledWith({
      where: { challengeVersionId: CV_ID, applicationCycleId: CYCLE_ID },
    });
  });

  it("refuses when a DomainApplication picked this CV", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
    mockPrisma.domainApplication.count.mockResolvedValue(1);

    await callAction({
      intent: "remove-challenge",
      cycleId: CYCLE_ID,
      challengeVersionId: CV_ID,
    });

    expect(mockPrisma.challengeVersionApplicationCycle.deleteMany).not.toHaveBeenCalled();
  });

  it("is a no-op when cycle is past Draft", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });

    await callAction({
      intent: "remove-challenge",
      cycleId: CYCLE_ID,
      challengeVersionId: CV_ID,
    });

    expect(mockPrisma.challengeVersionApplicationCycle.deleteMany).not.toHaveBeenCalled();
  });
});
