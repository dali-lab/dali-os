import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  return { McpError, McpInvalidError, McpNotFoundError, McpForbiddenError };
});
vi.mock("~/lib/db");
vi.mock("~/lib/google-calendar", () => ({
  searchCalendarEvents: vi.fn(),
}));
vi.mock("~/calendar/lib/search", async (orig) => {
  const real = await orig<typeof import("~/calendar/lib/search")>();
  return { ...real };
});

import { prisma } from "~/lib/db";
import { searchCalendarEvents } from "~/lib/google-calendar";
import { runSearchCalendar, SEARCH_CALENDAR_DEF } from "~/mcp/tools/calendar-extra/search-calendar";

const mockPrisma = prisma as unknown as {
  notification: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("search_calendar", () => {
  it("requires mcp:read scope", () => {
    expect(SEARCH_CALENDAR_DEF.requiredScope).toBe("mcp:read");
  });

  it("throws McpInvalidError for query shorter than 2 chars", async () => {
    await expect(
      runSearchCalendar("u1", { q: "a" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("returns local meeting hits", async () => {
    const start = new Date("2026-09-15T14:00:00Z");
    mockPrisma.notification.findMany.mockResolvedValue([
      {
        scheduledMeeting: {
          id: "m1",
          title: "Design Review",
          selectedAt: start,
          durationMinutes: 60,
        },
      },
    ]);
    vi.mocked(searchCalendarEvents).mockResolvedValue([]);

    const out = await runSearchCalendar("u1", { q: "Design" });
    expect(out.local).toHaveLength(1);
    expect(out.local[0]).toMatchObject({
      id: "meeting:m1",
      source: "meeting",
      title: "Design Review",
    });
    expect(out.google).toHaveLength(0);
    expect(out.googleError).toBeNull();
  });

  it("deduplicates multiple notifications for the same meeting", async () => {
    const start = new Date("2026-09-15T14:00:00Z");
    mockPrisma.notification.findMany.mockResolvedValue([
      { scheduledMeeting: { id: "m1", title: "Standup", selectedAt: start, durationMinutes: 30 } },
      { scheduledMeeting: { id: "m1", title: "Standup", selectedAt: start, durationMinutes: 30 } },
    ]);
    vi.mocked(searchCalendarEvents).mockResolvedValue([]);

    const out = await runSearchCalendar("u1", { q: "Stand" });
    expect(out.local).toHaveLength(1);
  });

  it("swallows Google errors and returns googleError string", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    vi.mocked(searchCalendarEvents).mockRejectedValue(new Error("Google API down"));

    const out = await runSearchCalendar("u1", { q: "test query" });
    expect(out.local).toHaveLength(0);
    expect(out.googleError).toBe("Google API down");
  });

  it("returns Google hits when available", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    vi.mocked(searchCalendarEvents).mockResolvedValue([
      {
        calendarId: "cal1",
        linkId: "link1",
        writable: false,
        eventId: "evt1",
        startIso: "2026-09-20T10:00:00Z",
        endIso: "2026-09-20T11:00:00Z",
        title: "External Sync",
        allDay: false,
        location: "Zoom",
        recurringEventId: undefined,
      },
    ]);

    const out = await runSearchCalendar("u1", { q: "External" });
    expect(out.google).toHaveLength(1);
    expect(out.google[0]).toMatchObject({
      source: "google",
      title: "External Sync",
      location: "Zoom",
    });
  });

  it("defaults to near scope", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    vi.mocked(searchCalendarEvents).mockResolvedValue([]);

    const out = await runSearchCalendar("u1", { q: "meeting" });
    expect(out.scope).toBe("near");
  });
});
