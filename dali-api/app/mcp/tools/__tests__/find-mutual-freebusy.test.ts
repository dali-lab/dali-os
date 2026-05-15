import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/google-calendar", () => ({
  fetchBusyEvents: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "~/lib/db";
import {
  runFindMutualFreebusy,
  FIND_MUTUAL_FREEBUSY_TOOL,
} from "~/mcp/tools/find-mutual-freebusy";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";

const mockPrisma = prisma as unknown as {
  userAvailabilitySettings: { findUnique: ReturnType<typeof vi.fn> };
  workingHoursDay: { findMany: ReturnType<typeof vi.fn> };
  manualBlock: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every user has a 9-5 weekday Mon-Fri working-hours schedule.
  mockPrisma.userAvailabilitySettings.findUnique.mockResolvedValue({
    timezone: "America/New_York",
    defaultEventBufferMin: 0,
  });
  mockPrisma.workingHoursDay.findMany.mockResolvedValue([]);
  mockPrisma.manualBlock.findMany.mockResolvedValue([]);
});

describe("find_mutual_freebusy", () => {
  it("requires mcp:read", () => {
    expect(FIND_MUTUAL_FREEBUSY_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects windows > 7 days", async () => {
    await expect(
      runFindMutualFreebusy("user-1", {
        participantUserIds: ["user-2"],
        windowStart: "2026-05-14T00:00:00Z",
        windowEnd: "2026-05-25T00:00:00Z",
      }),
    ).rejects.toThrow(/7 days/);
  });

  it("rejects invalid slotMinutes", async () => {
    await expect(
      runFindMutualFreebusy("user-1", {
        participantUserIds: ["user-2"],
        windowStart: "2026-05-14T00:00:00Z",
        windowEnd: "2026-05-15T00:00:00Z",
        slotMinutes: 7,
      }),
    ).rejects.toThrow(/slotMinutes/);
  });

  it("rejects > 8 participants including caller", async () => {
    await expect(
      runFindMutualFreebusy("user-1", {
        participantUserIds: [
          "u2",
          "u3",
          "u4",
          "u5",
          "u6",
          "u7",
          "u8",
          "u9",
        ],
        windowStart: "2026-05-14T00:00:00Z",
        windowEnd: "2026-05-15T00:00:00Z",
      }),
    ).rejects.toThrow(/Max 8 participants/);
  });

  it("returns mutual free slots in a single-weekday window", async () => {
    // Wed 2026-05-13 09:00 ET → 17:00 ET (default working hours).
    const out = await runFindMutualFreebusy("user-1", {
      participantUserIds: ["user-2"],
      windowStart: "2026-05-13T13:00:00Z", // 09:00 ET
      windowEnd: "2026-05-13T21:00:00Z", // 17:00 ET
      slotMinutes: 30,
    });
    expect(out.slots.length).toBeGreaterThan(0);
    expect(out.slots[0]).toMatchObject({
      start: "2026-05-13T13:00:00.000Z",
      end: "2026-05-13T21:00:00.000Z",
    });
  });

  it("rejects scope mismatch via dispatcher (shape check)", () => {
    // Validate the schema rejects bad payloads at validation time.
    const r = validateInput(
      { participantUserIds: "not-an-array" },
      FIND_MUTUAL_FREEBUSY_TOOL.inputSchema as JsonSchema,
    );
    expect(r.ok).toBe(false);
  });
});
