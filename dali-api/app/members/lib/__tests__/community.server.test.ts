import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    communityEvent: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/upcoming-meetings", () => ({ listUpcomingMeetings: vi.fn() }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (v: string | null) => (v ? `https://img/${v}` : null)) }));

import { prisma } from "~/lib/db.server";
import { getUserRoles } from "~/lib/roles";
import { listUpcomingMeetings } from "~/lib/upcoming-meetings";
import { loadCommunity, loadCommunityEvents, loadCommunityPeople, type CommunityViewerData } from "../community.server";

const db = prisma as unknown as {
  user: Record<"findMany" | "findUnique", ReturnType<typeof vi.fn>>;
  communityEvent: { findMany: ReturnType<typeof vi.fn> };
};
const roles = getUserRoles as unknown as ReturnType<typeof vi.fn>;
const meetings = listUpcomingMeetings as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-11-09T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  firstName: id,
  lastName: "Test",
  photoUrl: null,
  classYear: 2020,
  membershipStatus: "Alumni",
  currentLocation: "Austin, TX",
  currentLocationLat: 30.27,
  currentLocationLng: -97.74,
  openToCoffeeChats: true,
  openToResumeReviews: false,
  lastActiveAt: null,
  hideActivity: false,
  workExperiences: [],
  projectAssignments: [],
  coreAssignments: [],
  ...over,
});

const assignment = (projectId: string, name: string, code: string, sortKey: number, domain: string) => ({
  project: { id: projectId, name },
  term: { code, sortKey },
  domainId: domain === "Legacy" ? "domain_legacy" : `d-${domain}`,
  domain: { displayName: domain },
});

beforeEach(() => {
  vi.resetAllMocks();
  roles.mockResolvedValue({ isAlumni: true, isAdmin: false });
  db.user.findUnique.mockResolvedValue({
    firstName: "Vi",
    lastName: "Viewer",
    classYear: 2020,
    membershipStatus: "Alumni",
    currentLocationLat: 30.27,
    currentLocationLng: -97.74,
    projectAssignments: [{ projectId: "p1" }],
  });
  db.communityEvent.findMany.mockResolvedValue([]);
  meetings.mockResolvedValue([]);
});

describe("loadCommunityPeople", () => {
  it("returns alumni and students as plain data without the raw last-active time", async () => {
    db.user.findMany.mockResolvedValue([
      row("ada", {
        photoUrl: "a.jpg",
        lastActiveAt: hoursAgo(2),
        workExperiences: [{ position: "Designer", company: "Acme" }],
        projectAssignments: [
          assignment("p1", "Atlas", "20F", 200, "Design"),
          assignment("p1", "Atlas", "21S", 212, "Design"),
          assignment("p2", "Beacon", "19F", 190, "Development"),
        ],
        coreAssignments: [{ id: "c1" }],
      }),
    ]);
    const { people } = await loadCommunityPeople("viewer", NOW);
    expect(people).toEqual([
      {
        id: "ada",
        name: "ada Test",
        photoUrl: "https://img/a.jpg",
        classYear: 2020,
        isStudent: false,
        location: "Austin, TX",
        lat: 30.27,
        lng: -97.74,
        currentJob: "Designer at Acme",
        openToCoffeeChats: true,
        openToResumeReviews: false,
        activity: "today",
        roles: ["Design", "Development", "Core team"],
        projects: [
          { id: "p1", name: "Atlas", term: "21S" },
          { id: "p2", name: "Beacon", term: "19F" },
        ],
      },
    ]);
    expect(JSON.stringify(people)).not.toContain("lastActiveAt");
  });

  it("hides activity for someone who turned it off", async () => {
    db.user.findMany.mockResolvedValue([row("ada", { lastActiveAt: hoursAgo(1), hideActivity: true })]);
    expect((await loadCommunityPeople("viewer", NOW)).people[0].activity).toBeNull();
  });

  it("places students without a location in Hanover and leaves unplaced alumni off the map", async () => {
    db.user.findMany.mockResolvedValue([
      row("stu", { membershipStatus: "Active", currentLocation: null, currentLocationLat: null, currentLocationLng: null }),
      row("lost", { currentLocation: null, currentLocationLat: null, currentLocationLng: null }),
      row("far", { membershipStatus: "Active" }),
    ]);
    const { people, unplaced } = await loadCommunityPeople("viewer", NOW);
    expect(people.map((p) => [p.id, p.isStudent, p.location])).toEqual([
      ["stu", true, "Hanover, NH"],
      ["far", true, "Austin, TX"],
    ]);
    expect(unplaced).toBe(1);
  });

  it("reads everyone in one query, not one per person", async () => {
    db.user.findMany.mockResolvedValue([row("a"), row("b"), row("c")]);
    await loadCommunityPeople("viewer", NOW);
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("counts filter options across everyone", async () => {
    db.user.findMany.mockResolvedValue([
      row("a", { classYear: 2020, projectAssignments: [assignment("p1", "Atlas", "20F", 200, "Design")] }),
      row("b", { classYear: 2020, projectAssignments: [assignment("p1", "Atlas", "20F", 200, "Design")] }),
      row("c", { classYear: 2024, coreAssignments: [{ id: "x" }] }),
    ]);
    const { filterOptions } = await loadCommunityPeople("viewer", NOW);
    expect(filterOptions.classYears).toEqual([
      { value: 2024, count: 1 },
      { value: 2020, count: 2 },
    ]);
    expect(filterOptions.roles).toEqual([
      { value: "Design", count: 2 },
      { value: "Core team", count: 1 },
    ]);
    expect(filterOptions.projects).toEqual([{ id: "p1", name: "Atlas", term: "20F", count: 2 }]);
  });

  it("leaves the Legacy history bucket out of roles but keeps its projects", async () => {
    db.user.findMany.mockResolvedValue([
      row("a", {
        projectAssignments: [
          assignment("p1", "Atlas", "15F", 100, "Legacy"),
          assignment("p2", "Beacon", "20F", 200, "Design"),
        ],
      }),
      row("b", { projectAssignments: [assignment("p1", "Atlas", "15F", 100, "Legacy")] }),
    ]);
    const { people, filterOptions } = await loadCommunityPeople("viewer", NOW);
    expect(people.map((p) => p.roles)).toEqual([["Design"], []]);
    expect(filterOptions.roles).toEqual([{ value: "Design", count: 1 }]);
    expect(people[1].projects).toEqual([{ id: "p1", name: "Atlas", term: "15F" }]);
  });

  it("describes the viewer for matching", async () => {
    db.user.findMany.mockResolvedValue([]);
    const { viewer } = await loadCommunityPeople("viewer", NOW);
    expect(viewer).toEqual({
      id: "viewer",
      name: "Vi Viewer",
      isAlumni: true,
      canHost: true,
      hasLocation: true,
      classYear: 2020,
      projectIds: ["p1"],
      lat: 30.27,
      lng: -97.74,
    });
  });

  it("does not let a current student host", async () => {
    roles.mockResolvedValue({ isAlumni: false, isAdmin: false });
    db.user.findUnique.mockResolvedValue({ membershipStatus: "Active", projectAssignments: [], currentLocationLat: null, currentLocationLng: null });
    db.user.findMany.mockResolvedValue([]);
    const { viewer } = await loadCommunityPeople("viewer", NOW);
    expect(viewer).toMatchObject({ isAlumni: false, canHost: false, lat: 43.7044, lng: -72.2887 });
  });
});

const viewerData = (over: Partial<CommunityViewerData> = {}): CommunityViewerData => ({
  id: "viewer",
  name: "Vi",
  isAlumni: true,
  canHost: true,
  hasLocation: true,
  classYear: 2020,
  projectIds: ["p1"],
  lat: 30,
  lng: -97,
  ...over,
});

const eventRow = (over: Record<string, unknown> = {}) => ({
  id: "ev1",
  hostId: "host",
  title: "Mixer",
  description: null,
  startsAt: new Date("2026-11-20T23:00:00Z"),
  endsAt: new Date("2026-11-21T01:00:00Z"),
  online: false,
  meetingUrl: null,
  placeName: "Cafe",
  address: "1 Main",
  lat: 30,
  lng: -97,
  audience: "alumni_and_students",
  notifyNearby: false,
  host: { firstName: "Hal", lastName: "Host", photoUrl: null, workExperiences: [{ position: "CTO", company: "Co" }] },
  rsvps: [],
  ...over,
});

const rsvp = (userId: string, over: Record<string, unknown> = {}) => ({
  userId,
  user: { firstName: userId, lastName: "X", photoUrl: null, classYear: 2010, membershipStatus: "Alumni", projectAssignments: [], ...over },
});

describe("loadCommunityEvents", () => {
  it("asks for upcoming, not-cancelled events and every audience for alumni", async () => {
    await loadCommunityEvents(viewerData(), false, NOW);
    expect(db.communityEvent.findMany.mock.calls[0][0].where).toEqual({ cancelledAt: null, endsAt: { gte: NOW } });
  });

  it("shows students only the events open to students", async () => {
    await loadCommunityEvents(viewerData({ isAlumni: false }), false, NOW);
    expect(db.communityEvent.findMany.mock.calls[0][0].where).toEqual({
      cancelledAt: null,
      endsAt: { gte: NOW },
      audience: "alumni_and_students",
    });
  });

  it("counts who is going, puts people you know first, and flags the viewer", async () => {
    db.communityEvent.findMany.mockResolvedValue([
      eventRow({
        rsvps: [
          rsvp("stranger"),
          rsvp("viewer"),
          rsvp("classmate", { classYear: 2020 }),
          rsvp("teammate", { projectAssignments: [{ project: { id: "p1", name: "Atlas" }, term: { code: "20F" } }] }),
        ],
      }),
    ]);
    const [e] = await loadCommunityEvents(viewerData(), false, NOW);
    expect(e.goingCount).toBe(4);
    expect(e.viewerGoing).toBe(true);
    expect(e.knownGoingCount).toBe(2);
    expect(e.attendees.map((a) => [a.id, a.reason])).toEqual([
      ["classmate", "Your class"],
      ["teammate", "Also on Atlas, 20F"],
      ["stranger", null],
    ]);
  });

  it("shows at most five attendees", async () => {
    db.communityEvent.findMany.mockResolvedValue([eventRow({ rsvps: Array.from({ length: 9 }, (_, i) => rsvp(`u${i}`)) })]);
    const [e] = await loadCommunityEvents(viewerData(), false, NOW);
    expect(e.goingCount).toBe(9);
    expect(e.attendees).toHaveLength(5);
  });

  it("lets the host and admins manage an event, but not other members", async () => {
    db.communityEvent.findMany.mockResolvedValue([eventRow()]);
    expect((await loadCommunityEvents(viewerData({ id: "host" }), false, NOW))[0].canManage).toBe(true);
    expect((await loadCommunityEvents(viewerData(), true, NOW))[0].canManage).toBe(true);
    expect((await loadCommunityEvents(viewerData(), false, NOW))[0].canManage).toBe(false);
  });

  it("pins in-person DALI events at Hanover and files link-only ones under online", async () => {
    const meeting = (id: string, over: Record<string, unknown>) => ({
      id,
      title: id,
      startsAt: "2026-11-12T15:00:00.000Z",
      endsAt: "2026-11-12T16:00:00.000Z",
      location: null,
      meetingUrl: null,
      attendeeCount: 4,
      description: null,
      source: "dali",
      occurrenceStart: "2026-11-12T15:00:00.000Z",
      ...over,
    });
    meetings.mockResolvedValue([
      meeting("room", { location: "Studio" }),
      meeting("zoom", { meetingUrl: "https://zoom.example.edu/1" }),
      meeting("iv", { source: "interview" }),
    ]);
    const events = await loadCommunityEvents(viewerData(), false, NOW);
    expect(events.map((e) => [e.title, e.source, e.online, e.location, e.lat])).toEqual([
      ["room", "dali", false, "Studio", 43.7044],
      ["zoom", "dali", true, "Online", null],
    ]);
    expect(events[0].href).toContain("/calendar/meeting/room");
    expect(events[0].goingCount).toBe(4);
  });

  it("merges alumni and DALI events in start order", async () => {
    db.communityEvent.findMany.mockResolvedValue([eventRow()]);
    meetings.mockResolvedValue([
      { id: "m", title: "Early", startsAt: "2026-11-10T15:00:00.000Z", endsAt: "2026-11-10T16:00:00.000Z", location: "Studio", meetingUrl: null, attendeeCount: 2, description: null, source: "dali", occurrenceStart: "2026-11-10T15:00:00.000Z" },
    ]);
    expect((await loadCommunityEvents(viewerData(), false, NOW)).map((e) => e.title)).toEqual(["Early", "Mixer"]);
  });
});

describe("loadCommunity", () => {
  it("passes admin status through so admins can manage events", async () => {
    roles.mockResolvedValue({ isAlumni: false, isAdmin: true });
    db.user.findMany.mockResolvedValue([]);
    db.communityEvent.findMany.mockResolvedValue([eventRow()]);
    const data = await loadCommunity("viewer", NOW);
    expect(data.events[0].canManage).toBe(true);
  });
});
