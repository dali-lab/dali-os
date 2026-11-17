import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  communityEvent: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  projectTerm: { count: vi.fn() },
  projectAssignment: { findFirst: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma: db }));
const meetings = vi.hoisted(() => ({ listUpcomingMeetings: vi.fn() }));
vi.mock("~/calendar/lib/upcoming-meetings-list.server", () => meetings);

import { loadHomeEvents, loadTermProjects } from "../home-timeline.server";

const now = new Date("2026-11-17T12:00:00Z");
const row = (id: string, startsAt: string, rsvps: { userId: string; user: { classYear: number | null } }[] = []) => ({
  id,
  title: `Event ${id}`,
  startsAt: new Date(startsAt),
  online: false,
  placeName: "Hanover",
  host: { firstName: "Ada", lastName: "Lovelace" },
  rsvps,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.communityEvent.findMany.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue({ classYear: 2021 });
  meetings.listUpcomingMeetings.mockResolvedValue([]);
});

describe("loadHomeEvents", () => {
  it("asks only for upcoming, uncancelled events soonest first, capped at three", async () => {
    await loadHomeEvents({ id: "u1", isAlumni: true }, now);
    expect(db.communityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cancelledAt: null, endsAt: { gte: now } },
        orderBy: { startsAt: "asc" },
        take: 3,
      }),
    );
  });

  it("hides alumni-only events from anyone who is not alumni", async () => {
    await loadHomeEvents({ id: "u1", isAlumni: false }, now);
    expect(db.communityEvent.findMany.mock.calls[0][0].where).toMatchObject({ audience: "alumni_and_students" });
  });

  it("flags the viewer's RSVP and counts going and classmates without counting the viewer", async () => {
    db.communityEvent.findMany.mockResolvedValue([
      row("a", "2026-11-20T00:00:00Z", [
        { userId: "u1", user: { classYear: 2021 } },
        { userId: "u2", user: { classYear: 2021 } },
        { userId: "u3", user: { classYear: 2019 } },
      ]),
      row("b", "2026-11-21T00:00:00Z"),
    ]);
    const [a, b] = await loadHomeEvents({ id: "u1", isAlumni: true }, now);
    expect(a).toMatchObject({ id: "a", source: "alumni", viewerGoing: true, goingCount: 3, classmates: 1, hostName: "Ada Lovelace" });
    expect(b).toMatchObject({ viewerGoing: false, goingCount: 0, classmates: 0 });
  });

  it("has no classmates when the viewer has no class year", async () => {
    db.user.findUnique.mockResolvedValue({ classYear: null });
    db.communityEvent.findMany.mockResolvedValue([
      row("a", "2026-11-20T00:00:00Z", [{ userId: "u2", user: { classYear: null } }]),
    ]);
    const [a] = await loadHomeEvents({ id: "u1", isAlumni: true }, now);
    expect(a.classmates).toBe(0);
  });

  it("merges DALI meetings in start order, keeps only DALI ones, and caps at three", async () => {
    db.communityEvent.findMany.mockResolvedValue([
      row("a", "2026-11-25T00:00:00Z"),
      row("b", "2026-11-26T00:00:00Z"),
      row("c", "2026-11-27T00:00:00Z"),
    ]);
    meetings.listUpcomingMeetings.mockResolvedValue([
      { id: "m1", title: "Open house", startsAt: "2026-11-22T00:00:00Z", occurrenceStart: "2026-11-22T00:00:00Z", location: "Sudikoff", meetingUrl: null, attendeeCount: 9, source: "dali" },
      { id: "i1", title: "Interview", startsAt: "2026-11-18T00:00:00Z", occurrenceStart: "2026-11-18T00:00:00Z", location: null, meetingUrl: null, attendeeCount: 1, source: "interview" },
    ]);
    const events = await loadHomeEvents({ id: "u1", isAlumni: true }, now);
    expect(events.map((e) => e.id.split(":")[0])).toEqual(["dali", "a", "b"]);
    expect(events[0]).toMatchObject({ source: "dali", location: "Sudikoff", goingCount: 9, viewerGoing: false });
    expect(events[0].href).toContain("m1");
  });

  it("is empty when nothing is upcoming", async () => {
    expect(await loadHomeEvents({ id: "u1", isAlumni: true }, now)).toEqual([]);
  });
});

describe("loadTermProjects", () => {
  it("returns the term's project count and the viewer's old project still running", async () => {
    db.projectTerm.count.mockResolvedValue(14);
    db.projectAssignment.findFirst.mockResolvedValue({ project: { name: "Habitat Map" } });
    expect(await loadTermProjects("u1", "t1")).toEqual({ count: 14, oldProject: "Habitat Map" });
    expect(db.projectAssignment.findFirst.mock.calls[0][0].where).toMatchObject({
      userId: "u1",
      project: { projectTerms: { some: { termId: "t1" } } },
    });
  });

  it("has no old project when the viewer's projects are not running", async () => {
    db.projectTerm.count.mockResolvedValue(3);
    db.projectAssignment.findFirst.mockResolvedValue(null);
    expect(await loadTermProjects("u1", "t1")).toEqual({ count: 3, oldProject: null });
  });
});
