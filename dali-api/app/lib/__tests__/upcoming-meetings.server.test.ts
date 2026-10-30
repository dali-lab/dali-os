import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    scheduledMeeting: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/pageAccess.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/pageAccess.server")>("~/lib/pageAccess.server");
  return { ...actual, getPageAccessBulk: vi.fn() };
});

import { prisma } from "~/lib/db.server";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
import { UPCOMING_LIMIT, loadUpcomingMeetings } from "~/lib/upcoming-meetings.server";

const m = prisma as any;
const NOW = new Date("2026-10-13T12:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

const notebook = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "Notebook",
  parentPageId: null,
  workspaceType: "Lab",
  workspaceId: null,
  archivedAt: null,
  createdById: "someone",
  ...extra,
});

const meeting = (notebookId: string, extra: Record<string, unknown> = {}) => ({
  id: `m-${notebookId}`,
  title: `Meeting ${notebookId}`,
  selectedAt: hours(2),
  durationMinutes: 30,
  recurrenceRule: null,
  exceptions: [],
  notebook: notebook(notebookId),
  ...extra,
});

function allow(denied: string[] = []) {
  (getPageAccessBulk as any).mockImplementation(async (_u: string, pages: { id: string }[]) =>
    new Map(pages.map((p) => [p.id, { canView: !denied.includes(p.id) }])),
  );
}

const stub = (meetings: any[] = []) => m.scheduledMeeting.findMany.mockResolvedValue(meetings);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  allow();
});
afterEach(() => vi.useRealTimers());

it("shows three meetings, the same as the collapsed Favorites list", () => {
  expect(UPCOMING_LIMIT).toBe(3);
});

describe("loadUpcomingMeetings", () => {
  it("returns a one-off meeting inside the window, linking to its notes", async () => {
    stub([meeting("n1")]);
    expect(await loadUpcomingMeetings("u1")).toEqual([
      { meetingId: "m-n1", title: "Meeting n1", startsAt: hours(2).toISOString(), href: "/documents/n1" },
    ]);
  });

  it("links notes that live on a whiteboard or slides to their own viewer", async () => {
    stub([
      meeting("w", { notebook: notebook("w", { kind: "Whiteboard" }), selectedAt: hours(1) }),
      meeting("s", { notebook: notebook("s", { kind: "Slides" }), selectedAt: hours(2) }),
    ]);
    expect((await loadUpcomingMeetings("u1")).map((u) => u.href)).toEqual(["/whiteboard/w", "/slides/s"]);
  });

  it("skips one-offs that start after the 7 day window or have already started", async () => {
    stub([
      meeting("late", { selectedAt: new Date(NOW.getTime() + 8 * 86_400_000) }),
      meeting("past", { selectedAt: hours(-3) }),
      meeting("edge", { selectedAt: new Date(NOW.getTime() + 6.9 * 86_400_000) }),
    ]);
    expect((await loadUpcomingMeetings("u1")).map((u) => u.meetingId)).toEqual(["m-edge"]);
  });

  it("lists a series once when it has two occurrences in the window", async () => {
    stub([
      meeting("n1", {
        selectedAt: new Date(NOW.getTime() - 14 * 86_400_000 + 3 * 3_600_000),
        recurrenceRule: "FREQ=DAILY;INTERVAL=3",
      }),
    ]);
    const upcoming = await loadUpcomingMeetings("u1");
    expect(upcoming).toHaveLength(1);
    const at = new Date(upcoming[0].startsAt).getTime();
    expect(at).toBeGreaterThanOrEqual(NOW.getTime());
    expect(at).toBeLessThan(NOW.getTime() + 3 * 86_400_000);
  });

  it("lists one row per meeting even when two meetings share a notebook", async () => {
    stub([
      meeting("n1", { id: "later", title: "Later", selectedAt: hours(30) }),
      meeting("n1", { id: "sooner", title: "Sooner", selectedAt: hours(5) }),
    ]);
    expect((await loadUpcomingMeetings("u1")).map((u) => [u.meetingId, u.title, u.href])).toEqual([
      ["sooner", "Sooner", "/documents/n1"],
      ["later", "Later", "/documents/n1"],
    ]);
  });

  it("picks the soonest occurrence of a series", async () => {
    stub([meeting("n1", { selectedAt: hours(2), recurrenceRule: "FREQ=DAILY" })]);
    expect((await loadUpcomingMeetings("u1"))[0].startsAt).toBe(hours(2).toISOString());
  });

  it("skips a cancelled occurrence and moves on to the next one", async () => {
    const first = hours(2);
    stub([
      meeting("n1", {
        selectedAt: first,
        recurrenceRule: "FREQ=DAILY",
        exceptions: [{ originalStart: first, overrideStart: null, overrideDurationMin: null, cancelled: true }],
      }),
    ]);
    expect((await loadUpcomingMeetings("u1"))[0].startsAt).toBe(hours(26).toISOString());
  });

  it("follows an override that moves the occurrence", async () => {
    stub([
      meeting("n1", {
        selectedAt: hours(2),
        exceptions: [{ originalStart: hours(2), overrideStart: hours(10), overrideDurationMin: null, cancelled: false }],
      }),
    ]);
    expect((await loadUpcomingMeetings("u1"))[0].startsAt).toBe(hours(10).toISOString());
  });

  it("orders meetings soonest first and caps at the limit", async () => {
    stub(Array.from({ length: 12 }, (_, i) => meeting(`n${i}`, { selectedAt: hours(60 - i) })));
    const upcoming = await loadUpcomingMeetings("u1");
    expect(upcoming.map((u) => u.meetingId)).toEqual(["m-n11", "m-n10", "m-n9"]);
  });

  it("caps after dropping meetings whose notes the viewer cannot open", async () => {
    allow(["n0", "n2"]);
    stub(Array.from({ length: 6 }, (_, i) => meeting(`n${i}`, { selectedAt: hours(i + 1) })));
    expect((await loadUpcomingMeetings("u1")).map((u) => u.meetingId)).toEqual(["m-n1", "m-n3", "m-n4"]);
  });

  it("checks access once for every notebook", async () => {
    stub([meeting("a"), meeting("b", { selectedAt: hours(3) })]);
    await loadUpcomingMeetings("u1");
    expect(getPageAccessBulk).toHaveBeenCalledTimes(1);
    expect((getPageAccessBulk as any).mock.calls[0][1].map((p: { id: string }) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("returns nothing when the viewer has no meetings", async () => {
    stub([]);
    expect(await loadUpcomingMeetings("u1")).toEqual([]);
  });

  it("queries confirmed meetings with a notebook where the viewer organizes or participates", async () => {
    stub();
    await loadUpcomingMeetings("u1");
    const { where } = m.scheduledMeeting.findMany.mock.calls[0][0];
    expect(where).toMatchObject({ notebookId: { not: null }, status: "Confirmed" });
    expect(where.AND).toEqual([{ OR: [{ organizerId: "u1" }, { participantUserIds: { has: "u1" } }] }]);
  });

  it("scopes to the viewer's own meetings even for Core, with no Core-wide branch", async () => {
    stub();
    await loadUpcomingMeetings("core-user");
    const { where } = m.scheduledMeeting.findMany.mock.calls[0][0];
    expect(where.AND).toEqual([{ OR: [{ organizerId: "core-user" }, { participantUserIds: { has: "core-user" } }] }]);
  });
});
