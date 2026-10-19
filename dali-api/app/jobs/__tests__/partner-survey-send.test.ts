import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/partners/lib/partner-survey.server", () => ({ sendPartnerSurvey: vi.fn() }));

import { prisma } from "~/lib/db";
import { sendPartnerSurvey } from "~/partners/lib/partner-survey.server";
import { runPartnerSurveySend } from "~/jobs/partner-survey-send.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockSendSurvey = sendPartnerSurvey as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-10-06T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.projectPartner = { findMany: vi.fn().mockResolvedValue([]) };
  mockSendSurvey.mockResolvedValue({ ok: true });
});

describe("runPartnerSurveySend", () => {
  it("queries ended, unsent partnerships within the lookback window", async () => {
    await runPartnerSurveySend({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.projectPartner.findMany).toHaveBeenCalledWith({
      where: {
        endedAt: { not: null, gte: new Date("2026-09-06T12:00:00Z"), lte: NOW },
        surveySentAt: null,
      },
      select: { id: true },
      take: 200,
    });
  });

  it("sends once per candidate and counts successes", async () => {
    mockPrisma.projectPartner.findMany.mockResolvedValue([{ id: "pp1" }, { id: "pp2" }]);
    mockSendSurvey.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "no contact" });

    const result = await runPartnerSurveySend({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockSendSurvey).toHaveBeenCalledWith({ projectPartnerId: "pp1" });
    expect(mockSendSurvey).toHaveBeenCalledWith({ projectPartnerId: "pp2" });
    expect(result.items).toBe(1);
  });

  it("is a no-op when there are no candidates", async () => {
    const result = await runPartnerSurveySend({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockSendSurvey).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });
});
