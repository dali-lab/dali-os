import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "om-1", deduped: false })),
  drainNow: vi.fn(async () => {}),
}));
vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { logAuditEvent } from "~/lib/audit";
import {
  countDomainAddedRecipients,
  sendDomainAddedNotice,
} from "~/hiring/lib/domain-added-notice";

const mockPrisma = prisma as unknown as {
  applicationCycle: { findUnique: ReturnType<typeof vi.fn> };
  domainApplicationCycle: { findUnique: ReturnType<typeof vi.fn> };
  application: { findMany: ReturnType<typeof vi.fn> };
};

const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;

const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "domain-1";
const ACTOR_ID = "actor-1";

const CYCLE = { closeDate: new Date("2026-06-30T18:00:00Z") };
const DAC = { closeDate: null, domain: { name: "product-design", displayName: "Product Design" } };

function applicationRow(id: string, overrides: Partial<{ firstName: string; dartmouthEmail: string | null; netId: string | null }> = {}) {
  return {
    id,
    userId: `user-${id}`,
    user: {
      firstName: overrides.firstName ?? "Alex",
      dartmouthEmail: "dartmouthEmail" in overrides ? overrides.dartmouthEmail : `${id}@dartmouth.edu`,
      netId: "netId" in overrides ? overrides.netId : null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnqueue.mockResolvedValue({ id: "om-1", deduped: false });
  mockPrisma.applicationCycle.findUnique.mockResolvedValue(CYCLE);
  mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue(DAC);
  mockPrisma.application.findMany.mockResolvedValue([]);
});

describe("countDomainAddedRecipients", () => {
  it("counts the same recipients a send would reach", async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      applicationRow("a1"),
      applicationRow("a2", { dartmouthEmail: null, netId: "f00" }),
      applicationRow("a3", { dartmouthEmail: null, netId: null }),
    ]);
    expect(await countDomainAddedRecipients(CYCLE_ID)).toBe(2);
  });
});

describe("recipient query", () => {
  it("excludes Withdrawn and hired applicants, includes everyone else (Submitted and Draft), with no domain-selection filter", async () => {
    await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(mockPrisma.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          applicationCycleId: CYCLE_ID,
          statusUpdates: { none: { newStatus: "Withdrawn" } },
          NOT: {
            domainApplications: {
              some: { selected: true, decisions: { some: { type: "Accepted", stage: "Released" } } },
            },
          },
        },
      }),
    );
  });

  it("derives the recipient email from netId when dartmouthEmail is null", async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      applicationRow("a1", { dartmouthEmail: null, netId: "abc123" }),
    ]);
    await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(mockEnqueue.mock.calls[0][0].target).toBe("abc123@dartmouth.edu");
  });

  it("skips a recipient with no derivable email", async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      applicationRow("a1", { dartmouthEmail: null, netId: null }),
    ]);
    const result = await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(result).toEqual({ sent: 0, alreadySent: 0, skipped: 0 });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe("sendDomainAddedNotice — not_configured", () => {
  it("is not_configured (all skipped) when the cycle doesn't exist", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(null);
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1")]);
    const result = await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(result).toEqual({ sent: 0, alreadySent: 0, skipped: 1 });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("is not_configured when the domain isn't in the cycle", async () => {
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue(null);
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1")]);
    const result = await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(result).toEqual({ sent: 0, alreadySent: 0, skipped: 1 });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("audits the not_configured outcome", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(null);
    await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "email.domain_added_notice",
        userId: ACTOR_ID,
        targetId: DOMAIN_ID,
        metadata: expect.objectContaining({ outcome: "not_configured", cycleId: CYCLE_ID }),
      }),
    );
  });
});

describe("sendDomainAddedNotice — sending (default copy)", () => {
  it("sends the registry default copy naming the domain, its close date, and the apply link", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1", { firstName: "Alex" })]);
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue({
      closeDate: new Date("2026-07-15T18:00:00Z"),
      domain: { name: "product-design", displayName: "Product Design" },
    });
    const result = await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(result).toEqual({ sent: 1, alreadySent: 0, skipped: 0 });
    const call = mockEnqueue.mock.calls[0][0];
    expect(call.subject).toContain("Product Design");
    expect(call.bodyHtml).toContain("Alex");
    expect(call.bodyHtml).toContain("Product Design");
    expect(call.bodyHtml).toContain("July 15, 2026");
    expect(call.bodyHtml).toContain("stays as it is");
    expect(call.bodyHtml).toContain(`/portal/apply/${CYCLE_ID}`);
  });

  it("falls back to the cycle's own close date when the domain has no override", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1")]);
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue({
      closeDate: null,
      domain: { name: "product-design", displayName: "Product Design" },
    });
    await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    const call = mockEnqueue.mock.calls[0][0];
    expect(call.bodyHtml).toContain("June 30, 2026");
  });

  it("uses the domain's bare name when it has no displayName", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1")]);
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue({
      closeDate: new Date("2026-07-15T18:00:00Z"),
      domain: { name: "product-design", displayName: null },
    });
    await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(mockEnqueue.mock.calls[0][0].bodyHtml).toContain("product-design");
  });

  it("dedupes per (cycle, domain, application)", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1")]);
    await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(mockEnqueue.mock.calls[0][0].dedupKey).toBe(`hiring.domain-added:${CYCLE_ID}:${DOMAIN_ID}:a1`);
    expect(mockEnqueue.mock.calls[0][0].channel).toBe("email");
    expect(mockEnqueue.mock.calls[0][0].purpose).toBe("Hiring");
    expect(mockEnqueue.mock.calls[0][0].eventType).toBe("hiring.domain_added_notice");
  });

  it("counts a deduped enqueue as alreadySent and excludes it from drainNow", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1"), applicationRow("a2")]);
    mockEnqueue
      .mockResolvedValueOnce({ id: null, deduped: true })
      .mockResolvedValueOnce({ id: "om-2", deduped: false });
    const result = await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(result).toEqual({ sent: 1, alreadySent: 1, skipped: 0 });
    expect(drainNow).toHaveBeenCalledWith(["om-2"]);
  });

  it("counts a per-recipient failure as skipped without aborting the rest", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1"), applicationRow("a2")]);
    mockEnqueue
      .mockRejectedValueOnce(new Error("send failed"))
      .mockResolvedValueOnce({ id: "om-2", deduped: false });
    const result = await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(result).toEqual({ sent: 1, alreadySent: 0, skipped: 1 });
  });

  it("audits the sent outcome with the counts", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1")]);
    await sendDomainAddedNotice(CYCLE_ID, DOMAIN_ID, ACTOR_ID);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "email.domain_added_notice",
        userId: ACTOR_ID,
        targetId: DOMAIN_ID,
        metadata: expect.objectContaining({ cycleId: CYCLE_ID, attempted: 1, sent: 1, alreadySent: 0, skipped: 0 }),
      }),
    );
  });
});
