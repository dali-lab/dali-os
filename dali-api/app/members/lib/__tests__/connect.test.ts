import { describe, expect, it } from "vitest";
import {
  HANOVER,
  NO_PEOPLE_FILTERS,
  activityBucket,
  filterByBounds,
  filterEvents,
  filterPeople,
  groupByPlace,
  hasPeopleFilters,
  haversineKm,
  locatePerson,
  minZoomToFill,
  sortPeople,
  whyLine,
  type ConnectAlum,
  type ConnectPerson,
  type ConnectViewer,
} from "../connect";

const alum = (id: string, location: string, lat: number, lng: number): ConnectAlum => ({
  id,
  name: id,
  photoUrl: null,
  classYear: null,
  location,
  lat,
  lng,
  currentJob: null,
});

describe("groupByPlace", () => {
  it("puts alumni in the same city on one pin, biggest place first", () => {
    const places = groupByPlace([
      alum("a", "London, UK", 51.5074, -0.1278),
      alum("b", "New York, NY", 40.7128, -74.006),
      alum("c", "NYC", 40.7127, -74.0059),
      alum("d", "New York, NY", 40.7128, -74.006),
    ]);
    expect(places.map((p) => [p.label, p.people.map((a) => a.id)])).toEqual([
      ["New York, NY", ["b", "c", "d"]],
      ["London, UK", ["a"]],
    ]);
  });
});

describe("minZoomToFill", () => {
  it("never goes below zoom 2", () => {
    expect(minZoomToFill(0)).toBe(2);
    expect(minZoomToFill(400)).toBe(2);
    expect(minZoomToFill(1024)).toBe(2);
  });

  it("zooms in until the world is at least as tall as the map", () => {
    // 256 * 2^z must reach the height: 1025px needs z=3 (2048px), 2049px needs z=4.
    expect(minZoomToFill(1025)).toBe(3);
    expect(minZoomToFill(2048)).toBe(3);
    expect(minZoomToFill(2049)).toBe(4);
  });
});

const person = (id: string, over: Partial<ConnectPerson> = {}): ConnectPerson => ({
  id,
  name: id,
  photoUrl: null,
  classYear: null,
  isStudent: false,
  location: "Hanover, NH",
  lat: HANOVER.lat,
  lng: HANOVER.lng,
  currentJob: null,
  openToCoffeeChats: false,
  openToResumeReviews: false,
  activity: null,
  roles: [],
  projects: [],
  ...over,
});

const NOW = new Date("2026-11-09T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("activityBucket", () => {
  it("is today up to 24 hours, this week up to 7 days, and nothing after", () => {
    expect(activityBucket(ago(0), false, NOW)).toBe("today");
    expect(activityBucket(ago(DAY), false, NOW)).toBe("today");
    expect(activityBucket(ago(DAY + 1), false, NOW)).toBe("week");
    expect(activityBucket(ago(7 * DAY), false, NOW)).toBe("week");
    expect(activityBucket(ago(7 * DAY + 1), false, NOW)).toBeNull();
  });

  it("shows nothing for someone who hid their activity or never signed in", () => {
    expect(activityBucket(ago(HOUR), true, NOW)).toBeNull();
    expect(activityBucket(null, false, NOW)).toBeNull();
  });
});

describe("haversineKm", () => {
  it("measures Hanover to Boston at about 180 km and a point to itself at zero", () => {
    const boston = { lat: 42.3601, lng: -71.0589 };
    expect(haversineKm(HANOVER, boston)).toBeGreaterThan(175);
    expect(haversineKm(HANOVER, boston)).toBeLessThan(185);
    expect(haversineKm(HANOVER, HANOVER)).toBe(0);
  });
});

describe("locatePerson", () => {
  const blank = { currentLocation: null, currentLocationLat: null, currentLocationLng: null };

  it("uses the stored spot when there is one", () => {
    expect(
      locatePerson({ isStudent: false, currentLocation: "Austin, TX", currentLocationLat: 30.2, currentLocationLng: -97.7 }),
    ).toEqual({ location: "Austin, TX", lat: 30.2, lng: -97.7 });
  });

  it("puts a student with no location in Hanover", () => {
    expect(locatePerson({ isStudent: true, ...blank })).toEqual({
      location: "Hanover, NH",
      lat: 43.7044,
      lng: -72.2887,
    });
  });

  it("leaves an alum with no location off the map", () => {
    expect(locatePerson({ isStudent: false, ...blank })).toBeNull();
  });
});

describe("filterByBounds", () => {
  const items = [
    { id: "ny", lat: 40.7, lng: -74 },
    { id: "london", lat: 51.5, lng: -0.1 },
    { id: "none", lat: null, lng: null },
  ];

  it("keeps what is inside the view and drops the rest", () => {
    const view = { south: 35, west: -80, north: 45, east: -70 };
    expect(filterByBounds(items, view).map((i) => i.id)).toEqual(["ny"]);
  });

  it("handles a view that crosses the antimeridian", () => {
    const wrap = [{ id: "fiji", lat: -17, lng: 178 }, { id: "samoa", lat: -13.8, lng: -172 }, { id: "ny", lat: 40, lng: -74 }];
    expect(
      filterByBounds(wrap, { south: -30, west: 170, north: 0, east: -160 }).map((i) => i.id),
    ).toEqual(["fiji", "samoa"]);
  });

  it("returns everything when the map has no bounds yet", () => {
    expect(filterByBounds(items, null)).toHaveLength(3);
  });
});

describe("filterPeople", () => {
  const people = [
    person("ada", { classYear: 2020, roles: ["Design"], openToCoffeeChats: true, activity: "today", currentJob: "Designer at Acme", projects: [{ id: "p1", name: "Atlas", term: "20F" }] }),
    person("bo", { classYear: 2024, isStudent: true, roles: ["Development", "Core team"], openToResumeReviews: true, location: "Boston, MA" }),
    person("cy", { classYear: 2020, activity: "week" }),
  ];
  const ids = (f: Partial<typeof NO_PEOPLE_FILTERS>) =>
    filterPeople(people, { ...NO_PEOPLE_FILTERS, ...f }).map((p) => p.id);

  it("returns everyone with no filters set", () => {
    expect(ids({})).toEqual(["ada", "bo", "cy"]);
    expect(hasPeopleFilters(NO_PEOPLE_FILTERS)).toBe(false);
  });

  it("splits alumni from students", () => {
    expect(ids({ who: "alumni" })).toEqual(["ada", "cy"]);
    expect(ids({ who: "students" })).toEqual(["bo"]);
  });

  it("matches class years, roles and projects", () => {
    expect(ids({ classYears: [2020] })).toEqual(["ada", "cy"]);
    expect(ids({ roles: ["Core team"] })).toEqual(["bo"]);
    expect(ids({ projectIds: ["p1"] })).toEqual(["ada"]);
  });

  it("matches anyone open to coffee chats or resume reviews", () => {
    expect(ids({ openTo: ["coffee"] })).toEqual(["ada"]);
    expect(ids({ openTo: ["coffee", "resume"] })).toEqual(["ada", "bo"]);
  });

  it("keeps only people active this week", () => {
    expect(ids({ activeThisWeek: true })).toEqual(["ada", "cy"]);
  });

  it("searches name, job and place, and combines with chips", () => {
    expect(ids({ query: "acme" })).toEqual(["ada"]);
    expect(ids({ query: "boston" })).toEqual(["bo"]);
    expect(ids({ query: "boston", classYears: [2020] })).toEqual([]);
    expect(ids({ query: "boston", classYears: [2024] })).toEqual(["bo"]);
    expect(hasPeopleFilters({ ...NO_PEOPLE_FILTERS, activeThisWeek: true })).toBe(true);
  });
});

describe("whyLine and sortPeople", () => {
  const viewer: ConnectViewer = { classYear: 2020, projectIds: ["p1"], lat: HANOVER.lat, lng: HANOVER.lng };
  const atlas = [{ id: "p1", name: "Atlas", term: "20F" }];

  it("names a shared project with its term", () => {
    expect(whyLine(person("a", { projects: atlas }), viewer)).toBe("Also on Atlas, 20F");
  });

  it("says old project for a student on a project the viewer was on", () => {
    expect(whyLine(person("a", { projects: atlas, isStudent: true }), viewer)).toBe("On your old project");
  });

  it("falls back to class, then to nothing", () => {
    expect(whyLine(person("a", { classYear: 2020 }), viewer)).toBe("Your class");
    expect(whyLine(person("a", { classYear: 2019 }), viewer)).toBeNull();
  });

  it("puts shared projects first, then class, then city, then the rest by name", () => {
    const far = { location: "Paris", lat: 48.85, lng: 2.35 };
    const list = [
      person("zed", far),
      person("amy", far),
      person("near", { classYear: 2019 }),
      person("class", { classYear: 2020, ...far }),
      person("proj", { projects: atlas, ...far }),
    ];
    expect(sortPeople(list, "match", viewer).map((p) => p.id)).toEqual(["proj", "class", "near", "amy", "zed"]);
    expect(sortPeople(list, "name", viewer).map((p) => p.id)).toEqual(["amy", "class", "near", "proj", "zed"]);
  });
});

describe("filterEvents", () => {
  const ev = (title: string, over: Record<string, unknown> = {}) => ({
    title,
    source: "alumni" as const,
    online: false,
    startsAt: "2026-11-20T18:00:00Z",
    location: "Boston",
    hostName: "Ada",
    ...over,
  });
  const list = [
    ev("Mixer"),
    ev("Talk", { online: true, location: "Online" }),
    ev("Demo day", { source: "dali" as const, startsAt: "2027-03-01T18:00:00Z" }),
  ];
  const base = { query: "", host: "all" as const, mode: "all" as const, withinDays: null };

  it("filters by host kind, in person or online, and how far out", () => {
    expect(filterEvents(list, { ...base, host: "dali" }, NOW).map((e) => e.title)).toEqual(["Demo day"]);
    expect(filterEvents(list, { ...base, mode: "online" }, NOW).map((e) => e.title)).toEqual(["Talk"]);
    expect(filterEvents(list, { ...base, mode: "inPerson" }, NOW).map((e) => e.title)).toEqual(["Mixer", "Demo day"]);
    expect(filterEvents(list, { ...base, withinDays: 90 }, NOW).map((e) => e.title)).toEqual(["Mixer", "Talk"]);
  });

  it("searches title, host and city", () => {
    expect(filterEvents(list, { ...base, query: "ada" }, NOW)).toHaveLength(3);
    expect(filterEvents(list, { ...base, query: "demo" }, NOW)).toHaveLength(1);
  });
});

describe("groupByPlace counts", () => {
  it("counts students and alumni at each pin", () => {
    const places = groupByPlace([
      person("a"),
      person("b", { isStudent: true }),
      person("c", { isStudent: true }),
    ]);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ label: "Hanover, NH", alumniCount: 1, studentCount: 2 });
  });
});
