import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/hiring/lib/interview-emails", () => ({
  sendInterviewReminderEmails: vi.fn().mockResolvedValue(2),
}));

import { prisma } from "~/lib/db";
import { sendInterviewReminderEmails } from "~/hiring/lib/interview-emails";
import { runInterviewReminders } from "~/jobs/interview-reminders.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockSend = sendInterviewReminderEmails as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-07-15T12:00:00Z");

function p2002() {
  return Object.assign(new Error("unique violation"), { code: "P2002" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue(2);
  mockPrisma.interview.findMany.mockResolvedValue([]);
  mockPrisma.interviewReminderLog.create.mockResolvedValue({});
});

describe("interview-reminders", () => {
  it("claims DayBefore for an interview ~20h out and sends once", async () => {
    mockPrisma.interview.findMany.mockResolvedValue([
      { id: "i1", startTime: new Date("2026-07-16T08:00:00Z") },
    ]);

    const result = await runInterviewReminders({
      now: NOW,
      lastSuccessAt: null,
      settings: {},
    });

    expect(mockPrisma.interviewReminderLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.interviewReminderLog.create).toHaveBeenCalledWith({
      data: { interviewId: "i1", kind: "DayBefore" },
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result.items).toBe(2);
  });

  it("claims both tiers for an interview inside the hour but sends one reminder", async () => {
    mockPrisma.interview.findMany.mockResolvedValue([
      { id: "i1", startTime: new Date("2026-07-15T12:30:00Z") },
    ]);

    await runInterviewReminders({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.interviewReminderLog.create).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("sends the HourBefore tier even when DayBefore already went out", async () => {
    mockPrisma.interview.findMany.mockResolvedValue([
      { id: "i1", startTime: new Date("2026-07-15T12:30:00Z") },
    ]);
    mockPrisma.interviewReminderLog.create
      .mockRejectedValueOnce(p2002()) // DayBefore already claimed yesterday
      .mockResolvedValueOnce({});

    const result = await runInterviewReminders({
      now: NOW,
      lastSuccessAt: null,
      settings: {},
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result.items).toBe(2);
  });

  it("does nothing when every applicable tier was already claimed", async () => {
    mockPrisma.interview.findMany.mockResolvedValue([
      { id: "i1", startTime: new Date("2026-07-16T08:00:00Z") },
    ]);
    mockPrisma.interviewReminderLog.create.mockRejectedValue(p2002());

    const result = await runInterviewReminders({
      now: NOW,
      lastSuccessAt: null,
      settings: {},
    });

    expect(mockSend).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("only queries Scheduled interviews starting within 24h", async () => {
    await runInterviewReminders({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.interview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "Scheduled",
          startTime: { gt: NOW, lte: new Date("2026-07-16T12:00:00Z") },
        },
      }),
    );
  });
});
