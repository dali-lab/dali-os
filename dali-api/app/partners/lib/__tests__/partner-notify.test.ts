import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  getAdminUserIdsFromEnv: vi.fn(() => []),
  getActiveCoreCycleTermIds: vi.fn(async () => []),
}));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { getAdminUserIdsFromEnv, getActiveCoreCycleTermIds } from "~/lib/roles";
import { partnerNotifyRecipients, notifyPartners } from "~/partners/lib/partner-notify.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;
const mockEnvIds = getAdminUserIdsFromEnv as unknown as ReturnType<typeof vi.fn>;
const mockCycleTermIds = getActiveCoreCycleTermIds as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockEnvIds.mockReturnValue([]);
  mockCycleTermIds.mockResolvedValue([]);
  mockPrisma.adminMembership.findMany.mockResolvedValue([]);
  mockPrisma.coreAssignment.findMany.mockResolvedValue([]);
  mockNotify.mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 });
});

describe("partnerNotifyRecipients", () => {
  it("unions env admins, AdminMembership, and the active cycle's CoreAssignment rows", async () => {
    mockEnvIds.mockReturnValue(["env1"]);
    mockCycleTermIds.mockResolvedValue(["t1"]);
    mockPrisma.adminMembership.findMany.mockResolvedValue([{ userId: "admin1" }]);
    mockPrisma.coreAssignment.findMany.mockResolvedValue([{ userId: "core1" }, { userId: "admin1" }]);

    const ids = await partnerNotifyRecipients();

    expect(mockPrisma.coreAssignment.findMany).toHaveBeenCalledWith({
      where: { termId: { in: ["t1"] } },
      select: { userId: true },
    });
    expect([...new Set(ids)].sort()).toEqual(["admin1", "core1", "env1"]);
  });

  it("skips the CoreAssignment query when no cycle terms are active", async () => {
    mockCycleTermIds.mockResolvedValue([]);
    await partnerNotifyRecipients();
    expect(mockPrisma.coreAssignment.findMany).not.toHaveBeenCalled();
  });
});

describe("notifyPartners", () => {
  it("fans out to every Core recipient via notify()", async () => {
    mockPrisma.adminMembership.findMany.mockResolvedValue([{ userId: "u1" }]);
    mockPrisma.coreAssignment.findMany.mockResolvedValue([]);
    mockCycleTermIds.mockResolvedValue([]);

    await notifyPartners({
      eventType: "partner.stale",
      title: "Acme has gone quiet",
      body: "No activity in 14+ days.",
      link: "/core/partners?application=a1",
      dedupKey: "partner-stale:a1:2026-W40",
    });

    expect(mockNotify).toHaveBeenCalledWith({
      eventType: "partner.stale",
      createdByUserId: null,
      message: {
        title: "Acme has gone quiet",
        body: "No activity in 14+ days.",
        link: "/core/partners?application=a1",
        dedupKey: "partner-stale:a1:2026-W40",
      },
      recipients: [{ userId: "u1" }],
    });
  });

  it("no-ops without calling notify() when there are no Core recipients", async () => {
    const result = await notifyPartners({ eventType: "partner.stale", title: "x" });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(result).toEqual({ inApp: 0, emailed: 0, slackDmed: 0 });
  });
});
