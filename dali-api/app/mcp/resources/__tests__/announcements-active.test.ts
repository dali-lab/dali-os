import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import {
  readAnnouncementsActiveResource,
  ANNOUNCEMENTS_ACTIVE_RESOURCE,
} from "~/mcp/resources/announcements-active";

const mockPrisma = prisma as unknown as {
  notification: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.notification.count = vi.fn().mockResolvedValue(0);
});

describe("dali://announcements/active", () => {
  it("requires the mcp:read scope", () => {
    expect(ANNOUNCEMENTS_ACTIVE_RESOURCE.requiredScope).toBe("mcp:read");
  });

  it("renders markdown for each unread SystemAnnouncement", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        title: "Lab dinner Friday",
        body: "RSVP by Wed.",
        link: "/forms/fill/abc",
        dueAt: new Date("2026-06-05T22:00:00Z"),
        createdAt: new Date("2026-06-01T15:00:00Z"),
        createdBy: { firstName: "Pat", lastName: "Smith" },
      },
    ]);
    mockPrisma.notification.count.mockResolvedValue(1);
    const text = await readAnnouncementsActiveResource("u1");
    expect(text).not.toContain("Showing");
    expect(text).toContain("## Lab dinner Friday");
    expect(text).toContain("RSVP by Wed.");
    expect(text).toContain("by Pat Smith");
    expect(text).toContain("Due 2026-06-05T22:00:00.000Z");
    expect(text).toContain("[Open](/forms/fill/abc)");

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recipientUserId: "u1",
          readAt: null,
          kind: "SystemAnnouncement",
        }),
      }),
    );
  });

  it("returns a friendly placeholder when there are none", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    const text = await readAnnouncementsActiveResource("u1");
    expect(text).toBe("_No active announcements._");
  });

  it("says how many are shown out of the real total when capped", async () => {
    const row = (i: number) => ({
      id: `n${i}`,
      title: `A${i}`,
      body: null,
      link: null,
      dueAt: null,
      createdAt: new Date("2026-06-01T15:00:00Z"),
      createdBy: null,
    });
    mockPrisma.notification.findMany.mockResolvedValue(Array.from({ length: 50 }, (_, i) => row(i)));
    mockPrisma.notification.count.mockResolvedValue(73);
    const text = await readAnnouncementsActiveResource("u1");
    expect(text.startsWith("_Showing 50 of 73 active announcements, newest first._")).toBe(true);
    expect(mockPrisma.notification.findMany.mock.calls[0][0]).toMatchObject({
      take: 50,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });
});
