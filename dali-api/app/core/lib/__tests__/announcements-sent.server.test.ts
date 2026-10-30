import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    scheduledAnnouncement: { findMany: vi.fn(), count: vi.fn() },
    notification: { groupBy: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import {
  SENT_PAGE_SIZE,
  SENT_WHERE,
  countSentAnnouncements,
  loadSentAnnouncements,
} from "~/core/lib/announcements-sent.server";

const p = prisma as unknown as {
  scheduledAnnouncement: Record<string, ReturnType<typeof vi.fn>>;
  notification: Record<string, ReturnType<typeof vi.fn>>;
  user: Record<string, ReturnType<typeof vi.fn>>;
};
const groups = new Map([["g1", { name: "Design domain" }]]);

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `T ${id}`,
    body: null,
    createdByUserId: "ada",
    allMembers: false,
    groupIds: ["g1"],
    userIds: [],
    sendAt: new Date("2026-03-01T00:00:00Z"),
    sentAt: new Date("2026-03-01T00:00:00Z"),
    dueAt: null,
    ccDartmouth: false,
    sentCount: 7,
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  p.scheduledAnnouncement.findMany.mockResolvedValue([]);
  p.notification.groupBy.mockResolvedValue([]);
  p.user.findMany.mockResolvedValue([{ id: "ada", firstName: "Ada", lastName: "Lovelace" }]);
});

describe("countSentAnnouncements", () => {
  it("counts with the same where clause the list uses", async () => {
    p.scheduledAnnouncement.count.mockResolvedValue(41);
    expect(await countSentAnnouncements()).toBe(41);
    expect(p.scheduledAnnouncement.count).toHaveBeenCalledWith({ where: SENT_WHERE });
    await loadSentAnnouncements(null, groups);
    expect(p.scheduledAnnouncement.findMany.mock.calls[0][0].where.AND[0]).toBe(SENT_WHERE);
  });
});

describe("loadSentAnnouncements", () => {
  it("reads one past the page, ordered by sentAt then id, with no keyset on the first page", async () => {
    await loadSentAnnouncements(null, groups);
    const args = p.scheduledAnnouncement.findMany.mock.calls[0][0];
    expect(args.take).toBe(SENT_PAGE_SIZE + 1);
    expect(args.orderBy).toEqual([{ sentAt: "desc" }, { id: "desc" }]);
    expect(args.where.AND[1]).toEqual({});
  });

  it("continues after a cursor", async () => {
    await loadSentAnnouncements("2026-02-01T00:00:00.000Z|a9", groups);
    expect(p.scheduledAnnouncement.findMany.mock.calls[0][0].where.AND[1].OR[1]).toEqual({
      sentAt: new Date("2026-02-01T00:00:00.000Z"),
      id: { lt: "a9" },
    });
  });

  it("returns a cursor from the last row only when more rows exist", async () => {
    p.scheduledAnnouncement.findMany.mockResolvedValue(
      Array.from({ length: SENT_PAGE_SIZE + 1 }, (_, i) => row(`a${i}`)),
    );
    const page = await loadSentAnnouncements(null, groups);
    expect(page.items).toHaveLength(SENT_PAGE_SIZE);
    expect(page.nextCursor).toBe(`2026-03-01T00:00:00.000Z|a${SENT_PAGE_SIZE - 1}`);

    p.scheduledAnnouncement.findMany.mockResolvedValue([row("only")]);
    expect((await loadSentAnnouncements(null, groups)).nextCursor).toBeNull();
  });

  it("enriches every page with recipient and cleared counts, author and audience", async () => {
    p.scheduledAnnouncement.findMany.mockResolvedValue([row("a1"), row("a2")]);
    p.notification.groupBy.mockImplementation(async (args: { where: { readAt?: unknown } }) =>
      args.where.readAt ? [{ announcementId: "a1", _count: { _all: 2 } }] : [{ announcementId: "a1", _count: { _all: 5 } }],
    );
    const { items } = await loadSentAnnouncements("2026-02-01T00:00:00.000Z|a9", groups);
    expect(p.notification.groupBy.mock.calls[0][0].where.announcementId).toEqual({ in: ["a1", "a2"] });
    expect(items[0]).toMatchObject({ recipients: 5, completed: 2, author: "Ada Lovelace", audience: "Design domain" });
    expect(items[1]).toMatchObject({ recipients: 7, completed: 0 });
  });
});
