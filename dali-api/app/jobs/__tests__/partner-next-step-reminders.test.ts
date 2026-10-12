import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/partners/lib/partner-notify.server", () => ({ notifyPartners: vi.fn() }));

import { prisma } from "~/lib/db";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import { runPartnerNextStepReminders } from "~/jobs/partner-next-step-reminders.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockNotifyPartners = notifyPartners as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-10-06T15:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.partnerApplication.findMany.mockResolvedValue([]);
  mockNotifyPartners.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 0 });
});

describe("runPartnerNextStepReminders", () => {
  it("notifies for a card whose next step is due today, with a dedupKey keyed to the due instant", async () => {
    const dueAt = new Date("2026-10-06T09:00:00Z");
    mockPrisma.partnerApplication.findMany.mockResolvedValue([
      { id: "a1", title: "Acme", nextStep: "Send contract", nextStepDueAt: dueAt },
    ]);

    const result = await runPartnerNextStepReminders({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockNotifyPartners).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "partner.next_step_due",
        body: "Send contract",
        link: "/core/partners?application=a1",
        dedupKey: `partner-next-step:a1:${dueAt.toISOString()}`,
      }),
    );
    expect(result.items).toBe(1);
  });

  it("queries open stages with nextStepDueAt before tomorrow's UTC midnight", async () => {
    await runPartnerNextStepReminders({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.partnerApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stage: { in: ["New", "Interview"] },
          nextStepDueAt: { not: null, lt: new Date("2026-10-07T00:00:00.000Z") },
        },
        take: 200,
      }),
    );
  });

  it("does not notify for a card with no nextStepDueAt due yet (excluded by the query)", async () => {
    mockPrisma.partnerApplication.findMany.mockResolvedValue([]);
    const result = await runPartnerNextStepReminders({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockNotifyPartners).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });
});
