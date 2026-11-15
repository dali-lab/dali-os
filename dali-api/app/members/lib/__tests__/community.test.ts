import { describe, expect, it } from "vitest";
import {
  HANOVER,
  DEFAULT_EVENT_WINDOW_DAYS,
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
  clusterPlaces,
  countEventFilters,
  countPeopleFilters,
  edgePosition,
  mergeEdgePins,
  placesWithin,
  suggestPeople,
  suggestPlaces,
  type EdgeView,
  placesLabel,
  sortPeople,
  whyLine,
  type CommunityAlum,
  type CommunityPerson,
  type CommunityViewer,
} from "../community";

const alum = (id: string, location: string, lat: number, lng: number): CommunityAlum => ({
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
  it("never goes below zoom 1", () => {
    expect(minZoomToFill(0)).toBe(1);
    expect(minZoomToFill(400)).toBe(1);
    expect(minZoomToFill(1024)).toBe(1);
  });

  it("zooms in until the world is exactly as tall as the map", () => {
    expect(minZoomToFill(2048)).toBe(2);
    expect(minZoomToFill(4096)).toBe(3);
    expect(minZoomToFill(1536)).toBeCloseTo(Math.log2(3));
  });
});

const person = (id: string, over: Partial<CommunityPerson> = {}): CommunityPerson => ({
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
  const viewer: CommunityViewer = { classYear: 2020, projectIds: ["p1"], lat: HANOVER.lat, lng: HANOVER.lng };
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

describe("clusterPlaces", () => {
  const at = (key: string, lat: number, lng: number, size = 1) => ({ key, lat, lng, people: Array(size).fill(0) });
  const BOSTON = at("boston", 42.36, -71.06, 5);
  const CAMBRIDGE = at("cambridge", 42.37, -71.11, 2);
  const NYC = at("nyc", 40.71, -74.0, 9);
  const keys = (clusters: { key: string }[][]) => clusters.map((c) => c.map((p) => p.key));

  it("merges places within the radius, anchored on the biggest", () => {
    expect(keys(clusterPlaces([CAMBRIDGE, BOSTON, NYC], 7))).toEqual([["nyc"], ["boston", "cambridge"]]);
  });

  it("merges whole regions zoomed out and splits cities zoomed in", () => {
    expect(keys(clusterPlaces([CAMBRIDGE, BOSTON, NYC], 3))).toEqual([["nyc", "boston", "cambridge"]]);
    expect(keys(clusterPlaces([CAMBRIDGE, BOSTON, NYC], 12))).toEqual([["nyc"], ["boston"], ["cambridge"]]);
  });

  it("measures from the anchor, so a chain of places doesn't snowball", () => {
    const line = [at("a", 0, 0, 3), at("b", 0, 0.1, 2), at("c", 0, 0.2, 1)];
    expect(keys(clusterPlaces(line, 8, 64))).toEqual([["a", "b"], ["c"]]);
  });

  it("merges across the antimeridian", () => {
    expect(keys(clusterPlaces([at("w", -17, 179.9, 2), at("e", -17, -179.9)], 7))).toEqual([["w", "e"]]);
  });

  it("breaks ties by key so the result is stable", () => {
    expect(keys(clusterPlaces([at("b", 10, 10), at("a", 10, 10.01)], 5))).toEqual([["a", "b"]]);
  });
});

describe("placesLabel", () => {
  const p = (label: string, n: number) => ({ label, people: Array(n).fill(0) });

  it("names a single place", () => {
    expect(placesLabel([p("Boston, MA", 2)])).toBe("Boston, MA");
  });

  it("names a cluster after its biggest place", () => {
    expect(placesLabel([p("Cambridge, MA", 1), p("Boston, MA", 4)])).toBe("Boston, MA and 1 more place");
    expect(placesLabel([p("Cambridge, MA", 1), p("Boston, MA", 4), p("Somerville, MA", 1)])).toBe(
      "Boston, MA and 2 more places",
    );
  });
});

describe("filter counts", () => {
  it("counts each active filter once, however many values it holds", () => {
    expect(countPeopleFilters(NO_PEOPLE_FILTERS)).toBe(0);
    expect(
      countPeopleFilters({
        ...NO_PEOPLE_FILTERS,
        who: "alumni",
        classYears: [2019, 2020],
        openTo: ["coffee", "resume"],
        activeThisWeek: true,
      }),
    ).toBe(4);
  });

  it("treats the default event window as no filter", () => {
    const base = { host: "all", mode: "all", withinDays: DEFAULT_EVENT_WINDOW_DAYS } as const;
    expect(countEventFilters(base)).toBe(0);
    expect(countEventFilters({ ...base, withinDays: null, host: "dali", mode: "online" })).toBe(3);
  });
});

describe("place suggestions", () => {
  const spot = (key: string, label: string, lat: number, lng: number, n: number) => ({
    key,
    label,
    lat,
    lng,
    people: Array.from({ length: n }, (_, i) => `${key}${i}`),
  });
  const BOSTON = spot("bos", "Boston, MA", 42.36, -71.06, 20);
  const CAMBRIDGE = spot("cam", "Cambridge, MA", 42.37, -71.11, 6);
  const SOMERVILLE = spot("som", "Somerville, MA", 42.39, -71.1, 3);
  const QUINCY = spot("qui", "Quincy, MA", 42.25, -71.0, 2);
  const BROOKLINE = spot("bro", "Brookline, MA", 42.33, -71.12, 1);
  const LONDON = spot("lon", "London, UK", 51.5, -0.12, 9);
  const ALL = [LONDON, BOSTON, CAMBRIDGE, SOMERVILLE, QUINCY, BROOKLINE];

  it("suggests nothing under two characters or without a match", () => {
    expect(suggestPlaces(ALL, "b")).toEqual({ area: null, places: [] });
    expect(suggestPlaces(ALL, "zzz")).toEqual({ area: null, places: [] });
  });

  it("lists matching places with their people counts, biggest first", () => {
    const { places } = suggestPlaces(ALL, "ma");
    expect(places.map((p) => [p.label, p.count])).toEqual([
      ["Boston, MA", 20],
      ["Cambridge, MA", 6],
      ["Somerville, MA", 3],
      ["Quincy, MA", 2],
      ["Brookline, MA", 1],
    ]);
  });

  it("builds an area from the best match and every place within 40 km", () => {
    const { area } = suggestPlaces(ALL, "boston");
    expect(area).toEqual({
      name: "Boston, MA",
      keys: ["bos", "cam", "som", "qui", "bro"],
      subline: "Cambridge, MA, Somerville, MA, Quincy, MA and 1 more",
      count: 32,
    });
  });

  it("lists every other place when there are three or fewer", () => {
    expect(suggestPlaces([BOSTON, CAMBRIDGE], "bos").area?.subline).toBe("Cambridge, MA");
  });

  it("has no area when nothing else is within 40 km", () => {
    expect(suggestPlaces(ALL, "london").area).toBeNull();
  });

  it("prefers a label that starts with the query over a bigger one that only contains it", () => {
    const { area } = suggestPlaces([spot("a", "North York", 43.7, -79.4, 50), spot("b", "York, UK", 53.96, -1.08, 2)], "york");
    expect(area).toBeNull();
    expect(suggestPlaces([spot("a", "New York, NY", 40.7, -74, 50), spot("b", "York, PA", 39.96, -76.7, 2)], "york").places[0].label).toBe(
      "York, PA",
    );
  });

  it("measures the area from the anchor in kilometres", () => {
    expect(placesWithin(ALL, BOSTON).map((p) => p.key)).toEqual(["bos", "cam", "som", "qui", "bro"]);
    expect(placesWithin(ALL, BOSTON, 1).map((p) => p.key)).toEqual(["bos"]);
  });

  it("suggests up to three people by name or job", () => {
    const people = ["Ada Ray", "Ana Rao", "Rae Lin", "Ray Gun"].map((name, i) => ({
      name,
      currentJob: i === 3 ? null : "Engineer at Ray Co",
    }));
    expect(suggestPeople(people, "ray")).toHaveLength(3);
    expect(suggestPeople(people, "Lin")).toEqual([people[2]]);
    expect(suggestPeople(people, "r")).toEqual([]);
  });
});

describe("edgePosition", () => {
  const view: EdgeView = {
    center: { lat: 0, lng: 0 },
    bounds: { south: -10, west: -20, north: 10, east: 20 },
    width: 800,
    height: 400,
  };

  it("is null for a place in view", () => {
    expect(edgePosition(view, { lat: 2, lng: 3 })).toBeNull();
  });

  it("clamps to each side, inset from the border", () => {
    expect(edgePosition(view, { lat: 0, lng: 60 }, 20)).toEqual({ x: 780, y: 200, side: "right" });
    expect(edgePosition(view, { lat: 0, lng: -60 }, 20)).toEqual({ x: 20, y: 200, side: "left" });
    const top = edgePosition(view, { lat: 40, lng: 0 }, 20)!;
    expect(top).toMatchObject({ x: 400, y: 20, side: "top" });
    const bottom = edgePosition(view, { lat: -40, lng: 0 }, 20)!;
    expect(bottom).toMatchObject({ x: 400, y: 380, side: "bottom" });
  });

  it("keeps the direction from the centre, so a diagonal place lands off the middle of its side", () => {
    const p = edgePosition(view, { lat: 5, lng: 60 }, 20)!;
    expect(p.side).toBe("right");
    expect(p.x).toBeCloseTo(780);
    expect(p.y).toBeLessThan(200);
    expect(p.y).toBeGreaterThan(20);
  });

  it("pins to the corner when the place is diagonal past both limits", () => {
    const p = edgePosition({ ...view, bounds: { south: -10, west: -10, north: 10, east: 10 }, width: 400, height: 400 }, { lat: 60, lng: 60 }, 20)!;
    expect(p.x).toBeGreaterThan(300);
    expect(p.y).toBeLessThan(100);
    expect(Math.min(Math.abs(p.x - 380), Math.abs(p.y - 20))).toBeLessThan(40);
  });

  it("goes the short way around the antimeridian", () => {
    const pacific = { ...view, center: { lat: 0, lng: 175 }, bounds: { south: -10, west: 155, north: 10, east: -165 } };
    expect(edgePosition(pacific, { lat: 0, lng: -150 })!.side).toBe("right");
    expect(edgePosition(pacific, { lat: 0, lng: 100 })!.side).toBe("left");
  });

  it("is null before the map has a size", () => {
    expect(edgePosition({ ...view, width: 0 }, { lat: 0, lng: 60 })).toBeNull();
  });
});

describe("mergeEdgePins", () => {
  const pin = (key: string, count: number, x: number, y: number) => ({ key, label: `Place ${key}`, count, x, y, side: "right" as const });

  it("leaves pins that do not overlap alone", () => {
    expect(mergeEdgePins([pin("a", 1, 780, 40), pin("b", 2, 780, 300)])).toHaveLength(2);
  });

  it("merges overlapping pins: counts add up and the biggest place names it", () => {
    const [merged, ...rest] = mergeEdgePins([pin("a", 2, 780, 200), pin("b", 9, 780, 210), pin("c", 1, 780, 190)]);
    expect(rest).toEqual([]);
    expect(merged).toMatchObject({ key: "b", label: "Place b", count: 12, x: 780, y: 210 });
    expect(merged.keys.sort()).toEqual(["a", "b", "c"]);
  });
});
