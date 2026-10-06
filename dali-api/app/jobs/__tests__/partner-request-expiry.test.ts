import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/partners/lib/partner-activity.server", () => ({ logPartnerActivity: vi.fn() }));

import { prisma } from "~/lib/db";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import { runPartnerRequestExpiry } from "~/jobs/partner-request-expiry.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockLogActivity = logPartnerActivity as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-10-06T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.partnerMeetingRequest.findMany.mockResolvedValue([]);
  mockPrisma.partnerMeetingRequest.update.mockResolvedValue({});
  mockLogActivity.mockResolvedValue(undefined);
});

describe("runPartnerRequestExpiry", () => {
  it("marks a past-due Pending request Expired and logs a declined activity", async () => {
    mockPrisma.partnerMeetingRequest.findMany.mockResolvedValue([
      { id: "r1", applicationId: "a1", contactId: "c1" },
    ]);

    const result = await runPartnerRequestExpiry({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.partnerMeetingRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "Pending", startTime: { lt: NOW } },
        take: 200,
      }),
    );
    expect(mockPrisma.partnerMeetingRequest.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { status: "Expired" },
    });
    expect(mockLogActivity).toHaveBeenCalledWith(prisma, {
      applicationId: "a1",
      contactId: "c1",
      type: "MeetingRequestDeclined",
      body: "Request expired",
      metadata: { requestId: "r1", expired: true },
    });
    expect(result.items).toBe(1);
  });

  it("handles a request with no applicationId (project-page request)", async () => {
    mockPrisma.partnerMeetingRequest.findMany.mockResolvedValue([
      { id: "r2", applicationId: null, contactId: "c2" },
    ]);

    const result = await runPartnerRequestExpiry({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockLogActivity).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ applicationId: null, contactId: "c2" }),
    );
    expect(result.items).toBe(1);
  });

  it("no-ops when there are no expiring requests", async () => {
    const result = await runPartnerRequestExpiry({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockPrisma.partnerMeetingRequest.update).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });
});
