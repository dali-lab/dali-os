import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import {
  runListMyCalendarLinks,
  LIST_MY_CALENDAR_LINKS_TOOL,
} from "~/mcp/tools/list-my-calendar-links";

const mockPrisma = prisma as unknown as {
  userCalendarLink: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("list_my_calendar_links", () => {
  it("scope is read", () => {
    expect(LIST_MY_CALENDAR_LINKS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("reads only the caller's links, oldest first", async () => {
    mockPrisma.userCalendarLink.findMany.mockResolvedValue([]);
    expect(await runListMyCalendarLinks("u1")).toEqual({ links: [] });
    expect(mockPrisma.userCalendarLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" }, orderBy: { linkedAt: "asc" } }),
    );
  });

  it("flags sync errors without returning the error text and serializes dates", async () => {
    mockPrisma.userCalendarLink.findMany.mockResolvedValue([
      {
        id: "l1",
        provider: "Google",
        externalEmail: "ada@example.edu",
        displayName: "Ada",
        primary: true,
        enabled: true,
        syncError: "token expired",
        linkedAt: new Date("2026-09-01T12:00:00Z"),
        lastSyncedAt: new Date("2026-11-01T08:30:00Z"),
      },
      {
        id: "l2",
        provider: "Google",
        externalEmail: "ada.other@example.edu",
        displayName: null,
        primary: false,
        enabled: false,
        syncError: null,
        linkedAt: new Date("2026-10-01T12:00:00Z"),
        lastSyncedAt: null,
      },
    ]);
    const { links } = await runListMyCalendarLinks("u1");
    expect(links).toEqual([
      {
        id: "l1",
        provider: "Google",
        externalEmail: "ada@example.edu",
        displayName: "Ada",
        primary: true,
        enabled: true,
        hasSyncError: true,
        linkedAt: "2026-09-01T12:00:00.000Z",
        lastSyncedAt: "2026-11-01T08:30:00.000Z",
      },
      {
        id: "l2",
        provider: "Google",
        externalEmail: "ada.other@example.edu",
        displayName: null,
        primary: false,
        enabled: false,
        hasSyncError: false,
        linkedAt: "2026-10-01T12:00:00.000Z",
        lastSyncedAt: null,
      },
    ]);
    expect(JSON.stringify(links)).not.toContain("token expired");
  });
});
