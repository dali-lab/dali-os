import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    userFavorite: { findMany: vi.fn() },
    scheduledMeeting: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/pageAccess.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/pageAccess.server")>("~/lib/pageAccess.server");
  return { ...actual, getPageAccessBulk: vi.fn() };
});

import { prisma } from "~/lib/db";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
import { HOME_LIMIT, loadDriveHome } from "~/lib/drive-home.server";

const m = prisma as any;
const NOW = new Date("2026-10-13T12:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

const page = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Title ${id}`,
  kind: "FreeForm",
  iconEmoji: null,
  folderType: null,
  parentPageId: null,
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  partnerVisible: false,
  workspaceType: "Lab",
  workspaceId: null,
  archivedAt: null,
  createdById: "someone",
  ...extra,
});

const fav = (id: string, visitedAt: Date | null = NOW, extra: Record<string, unknown> = {}) => ({
  visitedAt,
  page: page(id, extra),
});

const meeting = (notebookId: string, extra: Record<string, unknown> = {}) => ({
  id: `m-${notebookId}`,
  title: `Meeting ${notebookId}`,
  selectedAt: hours(2),
  durationMinutes: 30,
  recurrenceRule: null,
  exceptions: [],
  notebook: page(notebookId, { kind: "Notebook" }),
  ...extra,
});

function allow(denied: string[] = []) {
  (getPageAccessBulk as any).mockImplementation(async (_u: string, pages: { id: string }[]) =>
    new Map(pages.map((p) => [p.id, { canView: !denied.includes(p.id) }])),
  );
}

function stub({
  recent = [] as any[],
  meetings = [] as any[],
} = {}) {
  m.userFavorite.findMany.mockResolvedValue(recent);
  m.scheduledMeeting.findMany.mockResolvedValue(meetings);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  allow();
});
afterEach(() => vi.useRealTimers());

describe("loadDriveHome recent", () => {
  it("maps pages to DriveItems with visitedAt", async () => {
    stub({ recent: [fav("a", hours(-1)), fav("w", hours(-2), { kind: "Whiteboard" }), fav("f", hours(-3), { kind: "Folder" })] });
    const home = await loadDriveHome("u1");
    expect(home.recent.map((i) => [i.id, i.type, i.href])).toEqual([
      ["a", "doc", "/documents/a"],
      ["w", "doc", "/whiteboard/w"],
      ["f", "folder", "/documents/f"],
    ]);
    expect(home.recent[0].visitedAt).toEqual(hours(-1));
    expect(home.recent[0].favorited).toBe(false);
  });

  it("has no starred section", async () => {
    stub({ recent: [fav("a")] });
    const home = await loadDriveHome("u1");
    expect(home).not.toHaveProperty("starred");
    expect(m.userFavorite.findMany).toHaveBeenCalledTimes(1);
    expect(m.userFavorite.findMany.mock.calls[0][0].where).not.toHaveProperty("favoritedAt");
  });

  it("drops pages the viewer can no longer view", async () => {
    allow(["b"]);
    stub({ recent: [fav("a"), fav("b"), fav("c")] });
    const home = await loadDriveHome("u1");
    expect(home.recent.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("caps the section after the access filter", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => fav(`p${i}`));
    allow(["p0", "p1"]);
    stub({ recent: rows });
    const home = await loadDriveHome("u1");
    expect(home.recent).toHaveLength(HOME_LIMIT);
    expect(home.recent[0].id).toBe("p2");
  });

  it("asks only for the viewer's live, non-shortcut pages ordered by recency", async () => {
    stub();
    await loadDriveHome("u1");
    const args = m.userFavorite.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ userId: "u1", visitedAt: { not: null } });
    expect(args.orderBy).toEqual({ visitedAt: "desc" });
    expect(args.where.page.is.archivedAt).toBeNull();
    expect(args.where.page.is.kind.in).not.toContain("Shortcut");
  });

  it("checks access once across recents and upcoming notebooks", async () => {
    stub({ recent: [fav("a"), fav("b")], meetings: [meeting("c")] });
    await loadDriveHome("u1");
    expect(getPageAccessBulk).toHaveBeenCalledTimes(1);
    const ids = (getPageAccessBulk as any).mock.calls[0][1].map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("loadDriveHome upcoming", () => {
  it("returns a notebook for a one-off meeting inside the window", async () => {
    stub({ meetings: [meeting("n1")] });
    const { upcoming } = await loadDriveHome("u1");
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({ meetingId: "m-n1", nextAt: hours(2), meetingTitle: "Meeting n1" });
    expect(upcoming[0].item).toMatchObject({ id: "n1", type: "doc", isNotebook: true });
  });

  it("skips one-offs that start after the 7 day window or have already started", async () => {
    stub({
      meetings: [
        meeting("late", { selectedAt: new Date(NOW.getTime() + 8 * 86_400_000) }),
        meeting("past", { selectedAt: hours(-3) }),
        meeting("edge", { selectedAt: new Date(NOW.getTime() + 6.9 * 86_400_000) }),
      ],
    });
    const { upcoming } = await loadDriveHome("u1");
    expect(upcoming.map((u) => u.item.id)).toEqual(["edge"]);
  });

  it("lists a notebook once when its weekly series has two occurrences in the window", async () => {
    stub({
      meetings: [
        meeting("n1", {
          selectedAt: new Date(NOW.getTime() - 14 * 86_400_000 + 3 * 3_600_000),
          recurrenceRule: "FREQ=DAILY;INTERVAL=3",
        }),
      ],
    });
    const { upcoming } = await loadDriveHome("u1");
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].nextAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    expect(upcoming[0].nextAt.getTime()).toBeLessThan(NOW.getTime() + 3 * 86_400_000);
  });

  it("lists one row per meeting even when two meetings share a notebook", async () => {
    stub({
      meetings: [
        meeting("n1", { id: "later", title: "Later", selectedAt: hours(30) }),
        meeting("n1", { id: "sooner", title: "Sooner", selectedAt: hours(5) }),
      ],
    });
    const { upcoming } = await loadDriveHome("u1");
    expect(upcoming.map((u) => [u.meetingId, u.meetingTitle, u.item.id])).toEqual([
      ["sooner", "Sooner", "n1"],
      ["later", "Later", "n1"],
    ]);
  });

  it("titles each row by the meeting, not the notebook", async () => {
    stub({ meetings: [meeting("n1", { title: "Weekly sync", notebook: page("n1", { kind: "Notebook", title: "Core meeting notes" }) })] });
    const { upcoming } = await loadDriveHome("u1");
    expect(upcoming[0].meetingTitle).toBe("Weekly sync");
    expect(upcoming[0].item.title).toBe("Core meeting notes");
  });

  it("picks the soonest occurrence of a series", async () => {
    stub({ meetings: [meeting("n1", { selectedAt: hours(2), recurrenceRule: "FREQ=DAILY" })] });
    const { upcoming } = await loadDriveHome("u1");
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].nextAt).toEqual(hours(2));
  });

  it("skips a cancelled occurrence and moves on to the next one", async () => {
    const first = hours(2);
    stub({
      meetings: [
        meeting("n1", {
          selectedAt: first,
          recurrenceRule: "FREQ=DAILY",
          exceptions: [{ originalStart: first, overrideStart: null, overrideDurationMin: null, cancelled: true }],
        }),
      ],
    });
    const { upcoming } = await loadDriveHome("u1");
    expect(upcoming[0].nextAt).toEqual(hours(26));
  });

  it("follows an override that moves the occurrence", async () => {
    stub({
      meetings: [
        meeting("n1", {
          selectedAt: hours(2),
          exceptions: [{ originalStart: hours(2), overrideStart: hours(10), overrideDurationMin: null, cancelled: false }],
        }),
      ],
    });
    const { upcoming } = await loadDriveHome("u1");
    expect(upcoming[0].nextAt).toEqual(hours(10));
  });

  it("orders meetings soonest first and caps at the limit", async () => {
    const meetings = Array.from({ length: 12 }, (_, i) => meeting(`n${i}`, { selectedAt: hours(60 - i) }));
    stub({ meetings });
    const { upcoming } = await loadDriveHome("u1");
    expect(upcoming).toHaveLength(HOME_LIMIT);
    expect(upcoming[0].item.id).toBe("n11");
    const times = upcoming.map((u) => u.nextAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("drops a meeting whose notebook the viewer cannot open", async () => {
    allow(["n2"]);
    stub({ meetings: [meeting("n1"), meeting("n2")] });
    const { upcoming } = await loadDriveHome("u1");
    expect(upcoming.map((u) => u.item.id)).toEqual(["n1"]);
  });

  it("queries confirmed meetings with a notebook where the viewer organizes or participates", async () => {
    stub();
    await loadDriveHome("u1");
    const { where } = m.scheduledMeeting.findMany.mock.calls[0][0];
    expect(where).toMatchObject({ notebookId: { not: null }, status: "Confirmed" });
    expect(where.AND).toEqual([{ OR: [{ organizerId: "u1" }, { participantUserIds: { has: "u1" } }] }]);
  });

  it("scopes to the viewer's own meetings even for Core, with no Core-wide branch", async () => {
    stub();
    await loadDriveHome("core-user");
    const { where } = m.scheduledMeeting.findMany.mock.calls[0][0];
    expect(where.AND).toEqual([{ OR: [{ organizerId: "core-user" }, { participantUserIds: { has: "core-user" } }] }]);
  });
});
