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
vi.mock("~/lib/db.server");
vi.mock("~/lib/google-calendar", () => ({
  searchCalendarEvents: vi.fn(),
}));
vi.mock("~/calendar/lib/search", async (orig) => {
  const real = await orig<typeof import("~/calendar/lib/search")>();
  return { ...real };
});

import { prisma } from "~/lib/db.server";
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

  it("pages local hits by Notification order, and skips Google on continuation pages", async () => {
    const row = (id: string, day: number) => ({
      id: `n${id}`,
      createdAt: new Date(Date.UTC(2026, 8, day)),
      scheduledMeeting: { id, title: `Sync ${id}`, selectedAt: new Date(Date.UTC(2026, 9, day)), durationMinutes: 30 },
    });
    mockPrisma.notification.findMany.mockResolvedValueOnce([row("m3", 3), row("m2", 2), row("m1", 1)]);
    vi.mocked(searchCalendarEvents).mockResolvedValue([]);

    const first = await runSearchCalendar("u1", { q: "Sync", limit: 2 });
    expect(first.local.map((h) => h.id).sort()).toEqual(["meeting:m2", "meeting:m3"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2 });
    expect(mockPrisma.notification.findMany.mock.calls[0][0]).toMatchObject({
      take: 3,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(searchCalendarEvents).toHaveBeenCalledTimes(1);

    mockPrisma.notification.findMany.mockResolvedValueOnce([row("m1", 1)]);
    const second = await runSearchCalendar("u1", { q: "Sync", limit: 2, cursor: first.page.nextCursor! });
    expect(mockPrisma.notification.findMany.mock.calls[1][0].where.AND[1].OR[0]).toEqual({
      createdAt: { lt: new Date(Date.UTC(2026, 8, 2)) },
    });
    expect(second.local.map((h) => h.id)).toEqual(["meeting:m1"]);
    expect(second.page).toMatchObject({ nextCursor: null, hasMore: false });
    expect(second.google).toEqual([]);
    expect(searchCalendarEvents).toHaveBeenCalledTimes(1);
  });

  it("defaults to 20 local hits per page", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    vi.mocked(searchCalendarEvents).mockResolvedValue([]);
    const out = await runSearchCalendar("u1", { q: "meeting" });
    expect(out.page.limit).toBe(20);
    expect(mockPrisma.notification.findMany.mock.calls[0][0].take).toBe(21);
  });

  it("reports googleTruncated when the Google read hit its page bound", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    vi.mocked(searchCalendarEvents).mockImplementation(async (...args) => {
      (args[4] as { truncated: boolean }).truncated = true;
      return [];
    });
    const out = await runSearchCalendar("u1", { q: "meeting" });
    expect(out.googleTruncated).toBe(true);
  });

  it("defaults to near scope", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    vi.mocked(searchCalendarEvents).mockResolvedValue([]);

    const out = await runSearchCalendar("u1", { q: "meeting" });
    expect(out.scope).toBe("near");
  });
});
