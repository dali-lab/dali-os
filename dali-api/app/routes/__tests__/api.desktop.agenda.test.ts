import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/calendar/lib/upcoming-meetings-list.server", () => ({ listUpcomingMeetings: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { listUpcomingMeetings } from "~/calendar/lib/upcoming-meetings-list.server";
import { loader } from "~/routes/api.desktop.agenda";

const USER_ID = "user-1";

function req() {
  return new Request("http://localhost/api/desktop/agenda");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
});

describe("GET /api/desktop/agenda", () => {
  it("returns the next dali meeting with its note page and no-store caching", async () => {
    vi.mocked(listUpcomingMeetings).mockResolvedValue([
      {
        id: "m1",
        title: "Sync",
        startsAt: "2026-05-14T14:00:00.000Z",
        endsAt: "2026-05-14T14:30:00.000Z",
        location: null,
        meetingUrl: "https://meet.example/m1",
        attendeeCount: 2,
        source: "dali",
        occurrenceStart: "2026-05-14T14:00:00.000Z",
        scheduledMeetingId: "m1",
      },
    ] as any);
    (prisma as any).scheduledMeeting.findUnique = vi.fn().mockResolvedValue({
      notePages: [
        { id: "note-1", meetingOccurrenceStart: new Date("2026-05-14T14:00:00.000Z") },
        { id: "note-2", meetingOccurrenceStart: new Date("2026-06-01T00:00:00.000Z") },
      ],
    });

    const res = await loader({ request: req() } as any);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json).toEqual({
      next: {
        id: "m1",
        source: "dali",
        title: "Sync",
        startsAt: "2026-05-14T14:00:00.000Z",
        endsAt: "2026-05-14T14:30:00.000Z",
        joinUrl: "https://meet.example/m1",
        link: "/calendar?meeting=m1",
        notePageId: "note-1",
        canRecord: true,
      },
      upcoming: [],
    });
  });

  it("returns an interview row with its hiring link, canRecord false, and no note lookup", async () => {
    vi.mocked(listUpcomingMeetings).mockResolvedValue([
      {
        id: "iv1",
        title: "Interview",
        startsAt: "2026-05-14T15:00:00.000Z",
        endsAt: "2026-05-14T15:30:00.000Z",
        location: "Pod Appa",
        meetingUrl: null,
        attendeeCount: 3,
        source: "interview",
        occurrenceStart: "2026-05-14T15:00:00.000Z",
        scheduledMeetingId: null,
      },
    ] as any);
    const findUnique = vi.fn();
    (prisma as any).scheduledMeeting.findUnique = findUnique;

    const json = await (await loader({ request: req() } as any)).json();
    expect(json).toEqual({
      next: {
        id: "iv1",
        source: "interview",
        title: "Interview",
        startsAt: "2026-05-14T15:00:00.000Z",
        endsAt: "2026-05-14T15:30:00.000Z",
        joinUrl: null,
        link: "/hiring/interviews/iv1",
        notePageId: null,
        canRecord: false,
      },
      upcoming: [],
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns next: null when nothing is in the window", async () => {
    vi.mocked(listUpcomingMeetings).mockResolvedValue([]);
    const json = await (await loader({ request: req() } as any)).json();
    expect(json).toEqual({ next: null, upcoming: [] });
  });

  const meeting = (id: string, startsAt: string, endsAt: string, source = "dali") =>
    ({
      id,
      title: `Meeting ${id}`,
      startsAt,
      endsAt,
      location: null,
      meetingUrl: null,
      attendeeCount: 1,
      source,
      occurrenceStart: startsAt,
      scheduledMeetingId: source === "dali" ? id : null,
    }) as any;

  it("asks for 48 hours so tomorrow's first meeting is available", async () => {
    vi.mocked(listUpcomingMeetings).mockResolvedValue([]);
    await loader({ request: req() } as any);
    expect(vi.mocked(listUpcomingMeetings).mock.calls[0][2]).toEqual(
      new Date("2026-05-16T12:00:00.000Z"),
    );
  });

  it("lists the meetings after next, with links, capped at three", async () => {
    vi.mocked(listUpcomingMeetings).mockResolvedValue([
      meeting("a", "2026-05-14T13:00:00.000Z", "2026-05-14T13:30:00.000Z"),
      meeting("b", "2026-05-14T14:00:00.000Z", "2026-05-14T14:30:00.000Z"),
      meeting("c", "2026-05-14T15:00:00.000Z", "2026-05-14T15:30:00.000Z", "interview"),
      meeting("d", "2026-05-14T16:00:00.000Z", "2026-05-14T16:30:00.000Z"),
      meeting("e", "2026-05-14T17:00:00.000Z", "2026-05-14T17:30:00.000Z"),
    ]);
    (prisma as any).scheduledMeeting.findUnique = vi.fn().mockResolvedValue({ notePages: [] });

    const json = await (await loader({ request: req() } as any)).json();
    expect(json.next.id).toBe("a");
    expect(json.upcoming).toEqual([
      {
        id: "b",
        title: "Meeting b",
        startsAt: "2026-05-14T14:00:00.000Z",
        link: "/calendar?meeting=b",
      },
      {
        id: "c",
        title: "Meeting c",
        startsAt: "2026-05-14T15:00:00.000Z",
        link: "/hiring/interviews/c",
      },
      {
        id: "d",
        title: "Meeting d",
        startsAt: "2026-05-14T16:00:00.000Z",
        link: "/calendar?meeting=d",
      },
    ]);
  });

  it("keeps next to 12 hours but still reports a later meeting in upcoming", async () => {
    vi.mocked(listUpcomingMeetings).mockResolvedValue([
      meeting("tomorrow", "2026-05-15T13:30:00.000Z", "2026-05-15T14:00:00.000Z"),
    ]);
    const json = await (await loader({ request: req() } as any)).json();
    expect(json.next).toBeNull();
    expect(json.upcoming.map((r: { id: string }) => r.id)).toEqual(["tomorrow"]);
  });

  it("leaves meetings that already ended out of both fields", async () => {
    vi.mocked(listUpcomingMeetings).mockResolvedValue([
      meeting("ended", "2026-05-14T11:00:00.000Z", "2026-05-14T11:30:00.000Z"),
    ]);
    const json = await (await loader({ request: req() } as any)).json();
    expect(json).toEqual({ next: null, upcoming: [] });
  });

  it("still returns an in-progress meeting whose end is ahead of now", async () => {
    vi.mocked(listUpcomingMeetings).mockResolvedValue([
      {
        id: "m-live",
        title: "Live now",
        startsAt: "2026-05-14T11:45:00.000Z",
        endsAt: "2026-05-14T12:15:00.000Z",
        location: null,
        meetingUrl: null,
        attendeeCount: 1,
        source: "dali",
        occurrenceStart: "2026-05-14T11:45:00.000Z",
        scheduledMeetingId: "m-live",
      },
    ] as any);
    (prisma as any).scheduledMeeting.findUnique = vi.fn().mockResolvedValue({ notePages: [] });

    const json = await (await loader({ request: req() } as any)).json();
    expect(json.next.id).toBe("m-live");
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response("unauth", { status: 401 }),
    } as any);
    const res = await loader({ request: req() } as any);
    expect(res.status).toBe(401);
    expect(listUpcomingMeetings).not.toHaveBeenCalled();
  });
});
