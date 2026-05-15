import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  runListMyUpcomingMeetings,
  LIST_MY_UPCOMING_MEETINGS_TOOL,
} from "~/mcp/tools/list-my-upcoming-meetings";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";

const mockPrisma = prisma as unknown as {
  scheduledMeeting: { findMany: ReturnType<typeof vi.fn> };
  interview: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));
});

describe("list_my_upcoming_meetings", () => {
  it("requires mcp:read", () => {
    expect(LIST_MY_UPCOMING_MEETINGS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns scheduled meetings + interviews sorted by start", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      {
        id: "m1",
        organizerId: "user-1",
        title: "Sync",
        durationMinutes: 30,
        selectedAt: new Date("2026-05-15T14:00:00Z"),
        recurrenceRule: null,
        participantUserIds: ["user-1", "user-2"],
        status: "Confirmed",
        exceptions: [],
      },
    ]);
    mockPrisma.interview.findMany.mockResolvedValue([
      {
        id: "iv1",
        startTime: new Date("2026-05-14T15:00:00Z"),
        endTime: new Date("2026-05-14T15:30:00Z"),
        location: "PodAppa",
        assignments: [{ id: "a1" }, { id: "a2" }],
      },
    ]);

    const out = await runListMyUpcomingMeetings("user-1", { daysAhead: 7 });
    expect(out.meetings).toHaveLength(2);
    expect(out.meetings[0].id).toBe("iv1");
    expect(out.meetings[0].source).toBe("interview");
    expect(out.meetings[1].id).toBe("m1");
    expect(out.meetings[1].source).toBe("dali");
    expect(out.meetings[1].attendeeCount).toBe(2);
  });

  it("excludes past events and cancelled exceptions", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      {
        id: "m-past",
        organizerId: "user-1",
        title: "Old",
        durationMinutes: 30,
        selectedAt: new Date("2026-05-10T12:00:00Z"),
        recurrenceRule: null,
        participantUserIds: ["user-1"],
        status: "Confirmed",
        exceptions: [],
      },
      {
        id: "m-cancelled",
        organizerId: "user-1",
        title: "Cancelled by exception",
        durationMinutes: 30,
        selectedAt: new Date("2026-05-15T14:00:00Z"),
        recurrenceRule: null,
        participantUserIds: ["user-1"],
        status: "Confirmed",
        exceptions: [
          {
            originalStart: new Date("2026-05-15T14:00:00Z"),
            cancelled: true,
            overrideStart: null,
            overrideDurationMin: null,
            overrideTitle: null,
          },
        ],
      },
    ]);
    mockPrisma.interview.findMany.mockResolvedValue([]);

    const out = await runListMyUpcomingMeetings("user-1", {});
    expect(out.meetings).toEqual([]);
  });

  it("rejects daysAhead > 30 via the input validator", () => {
    const r = validateInput(
      { daysAhead: 99 },
      LIST_MY_UPCOMING_MEETINGS_TOOL.inputSchema as JsonSchema,
    );
    expect(r.ok).toBe(false);
  });

  it("returns empty when there are no meetings or interviews", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([]);
    mockPrisma.interview.findMany.mockResolvedValue([]);
    const out = await runListMyUpcomingMeetings("user-1", {});
    expect(out.meetings).toEqual([]);
  });
});
