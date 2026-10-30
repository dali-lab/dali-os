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

function run() {
  return runInterviewReminders({ now: NOW, lastSuccessAt: null, settings: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue(2);
  mockPrisma.interview.findMany.mockResolvedValue([]);
  mockPrisma.interviewReminderLog.create.mockResolvedValue({});
});

describe("interview-reminders", () => {
  it("only queries Scheduled interviews starting within the next hour", async () => {
    await run();

    expect(mockPrisma.interview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "Scheduled",
          startTime: { gt: NOW, lte: new Date("2026-07-15T13:00:00Z") },
        },
      }),
    );
  });

  it("claims HourBefore and sends once for an interview inside the hour", async () => {
    mockPrisma.interview.findMany.mockResolvedValue([{ id: "i1" }]);

    const result = await run();

    expect(mockPrisma.interviewReminderLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.interviewReminderLog.create).toHaveBeenCalledWith({
      data: { interviewId: "i1", kind: "HourBefore" },
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith("i1");
    expect(result.items).toBe(2);
  });

  it("never claims a DayBefore tier", async () => {
    mockPrisma.interview.findMany.mockResolvedValue([{ id: "i1" }, { id: "i2" }]);

    await run();

    const kinds = mockPrisma.interviewReminderLog.create.mock.calls.map(
      ([arg]) => arg.data.kind,
    );
    expect(kinds).toEqual(["HourBefore", "HourBefore"]);
  });

  it("skips an interview whose reminder was already claimed", async () => {
    mockPrisma.interview.findMany.mockResolvedValue([{ id: "i1" }, { id: "i2" }]);
    mockPrisma.interviewReminderLog.create
      .mockRejectedValueOnce(p2002())
      .mockResolvedValueOnce({});

    const result = await run();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith("i2");
    expect(result.items).toBe(2);
  });

  it("rethrows non-unique ledger errors without sending", async () => {
    mockPrisma.interview.findMany.mockResolvedValue([{ id: "i1" }]);
    mockPrisma.interviewReminderLog.create.mockRejectedValue(new Error("db down"));

    await expect(run()).rejects.toThrow("db down");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sums sent counts across interviews", async () => {
    mockPrisma.interview.findMany.mockResolvedValue([{ id: "i1" }, { id: "i2" }]);
    mockSend.mockResolvedValueOnce(2).mockResolvedValueOnce(3);

    const result = await run();

    expect(result.items).toBe(5);
  });
});
