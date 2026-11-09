// Connect map: people who share a place share a pin. Client-safe.

export const HANOVER = { label: "Hanover, NH", lat: 43.7044, lng: -72.2887 } as const;
export const NEARBY_KM = 50;

export type Activity = "today" | "week" | null;

export type ConnectPerson = {
  id: string;
  name: string;
  photoUrl: string | null;
  classYear: number | null;
  isStudent: boolean;
  location: string;
  lat: number;
  lng: number;
  /** "Position at Company" for their current job, if they list one. */
  currentJob: string | null;
  openToCoffeeChats: boolean;
  openToResumeReviews: boolean;
  activity: Activity;
  /** Domain names from their project terms, plus "Core team". */
  roles: string[];
  projects: { id: string; name: string; term: string }[];
};

export type ConnectAlum = Pick<
  ConnectPerson,
  "id" | "name" | "photoUrl" | "classYear" | "location" | "lat" | "lng" | "currentJob"
> &
  Partial<ConnectPerson>;

type Located = { id: string; location: string; lat: number; lng: number; isStudent?: boolean };

export type ConnectPlace<T extends Located = ConnectAlum> = {
  key: string;
  label: string;
  lat: number;
  lng: number;
  people: T[];
  alumniCount: number;
  studentCount: number;
};

const DAY_MS = 86_400_000;

export function activityBucket(
  lastActiveAt: Date | string | null | undefined,
  hideActivity: boolean,
  now: Date = new Date(),
): Activity {
  if (hideActivity || !lastActiveAt) return null;
  const age = now.getTime() - new Date(lastActiveAt).getTime();
  if (age <= DAY_MS) return "today";
  if (age <= 7 * DAY_MS) return "week";
  return null;
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Where a person pins: their own spot, or Hanover for a student who hasn't set one. */
export function locatePerson(u: {
  isStudent: boolean;
  currentLocation: string | null;
  currentLocationLat: number | null;
  currentLocationLng: number | null;
}): { location: string; lat: number; lng: number } | null {
  if (u.currentLocationLat != null && u.currentLocationLng != null) {
    return {
      location: u.currentLocation || HANOVER.label,
      lat: u.currentLocationLat,
      lng: u.currentLocationLng,
    };
  }
  return u.isStudent ? { location: HANOVER.label, lat: HANOVER.lat, lng: HANOVER.lng } : null;
}

export type MapBounds = { south: number; west: number; north: number; east: number };

export function inBounds(p: { lat: number; lng: number }, b: MapBounds): boolean {
  if (p.lat < b.south || p.lat > b.north) return false;
  return b.west <= b.east ? p.lng >= b.west && p.lng <= b.east : p.lng >= b.west || p.lng <= b.east;
}

export function filterByBounds<T extends { lat: number | null; lng: number | null }>(
  items: readonly T[],
  bounds: MapBounds | null,
): T[] {
  if (!bounds) return [...items];
  return items.filter(
    (i) => i.lat != null && i.lng != null && inBounds({ lat: i.lat, lng: i.lng }, bounds),
  );
}

export type PeopleFilters = {
  query: string;
  who: "all" | "alumni" | "students";
  classYears: number[];
  roles: string[];
  projectIds: string[];
  openTo: ("coffee" | "resume")[];
  activeThisWeek: boolean;
};

export const NO_PEOPLE_FILTERS: PeopleFilters = {
  query: "",
  who: "all",
  classYears: [],
  roles: [],
  projectIds: [],
  openTo: [],
  activeThisWeek: false,
};

export function hasPeopleFilters(f: PeopleFilters): boolean {
  return (
    f.who !== "all" ||
    f.classYears.length > 0 ||
    f.roles.length > 0 ||
    f.projectIds.length > 0 ||
    f.openTo.length > 0 ||
    f.activeThisWeek
  );
}

export function filterPeople(people: readonly ConnectPerson[], f: PeopleFilters): ConnectPerson[] {
  const q = f.query.trim().toLowerCase();
  return people.filter((p) => {
    if (q && ![p.name, p.currentJob ?? "", p.location].join(" ").toLowerCase().includes(q)) {
      return false;
    }
    if (f.who === "alumni" && p.isStudent) return false;
    if (f.who === "students" && !p.isStudent) return false;
    if (f.classYears.length && (p.classYear == null || !f.classYears.includes(p.classYear))) {
      return false;
    }
    if (f.roles.length && !p.roles.some((r) => f.roles.includes(r))) return false;
    if (f.projectIds.length && !p.projects.some((pr) => f.projectIds.includes(pr.id))) return false;
    if (
      f.openTo.length &&
      !(
        (f.openTo.includes("coffee") && p.openToCoffeeChats) ||
        (f.openTo.includes("resume") && p.openToResumeReviews)
      )
    ) {
      return false;
    }
    if (f.activeThisWeek && p.activity == null) return false;
    return true;
  });
}

export type EventAudience = "alumni" | "alumni_and_students";

export type ConnectViewer = {
  classYear: number | null;
  projectIds: string[];
  lat: number | null;
  lng: number | null;
};

/** The one teal line under a row: what you share with them. */
export function whyLine(
  p: Pick<ConnectPerson, "projects" | "isStudent" | "classYear">,
  viewer: ConnectViewer,
): string | null {
  const shared = p.projects.find((pr) => viewer.projectIds.includes(pr.id));
  if (shared) {
    return p.isStudent ? "On your old project" : `Also on ${shared.name}, ${shared.term}`;
  }
  if (p.classYear != null && p.classYear === viewer.classYear) return "Your class";
  return null;
}

export function isNearViewer(p: { lat: number; lng: number }, viewer: ConnectViewer): boolean {
  if (viewer.lat == null || viewer.lng == null) return false;
  return haversineKm(p, { lat: viewer.lat, lng: viewer.lng }) <= NEARBY_KM;
}

function matchScore(p: ConnectPerson, viewer: ConnectViewer): number {
  let score = 0;
  if (p.projects.some((pr) => viewer.projectIds.includes(pr.id))) score += 4;
  if (p.classYear != null && p.classYear === viewer.classYear) score += 2;
  if (isNearViewer(p, viewer)) score += 1;
  return score;
}

export function sortPeople(
  people: readonly ConnectPerson[],
  by: "match" | "name",
  viewer: ConnectViewer,
): ConnectPerson[] {
  const byName = (a: ConnectPerson, b: ConnectPerson) => a.name.localeCompare(b.name);
  return [...people].sort(
    by === "name" ? byName : (a, b) => matchScore(b, viewer) - matchScore(a, viewer) || byName(a, b),
  );
}

export type EventFilters = {
  query: string;
  host: "all" | "alumni" | "dali";
  mode: "all" | "inPerson" | "online";
  withinDays: number | null;
};

export type EventLike = {
  title: string;
  source: "alumni" | "dali";
  online: boolean;
  startsAt: string;
  location: string | null;
  hostName?: string | null;
};

export function filterEvents<T extends EventLike>(
  events: readonly T[],
  f: EventFilters,
  now: Date = new Date(),
): T[] {
  const q = f.query.trim().toLowerCase();
  const cutoff = f.withinDays == null ? null : now.getTime() + f.withinDays * DAY_MS;
  return events.filter((e) => {
    if (q && ![e.title, e.hostName ?? "", e.location ?? ""].join(" ").toLowerCase().includes(q)) {
      return false;
    }
    if (f.host !== "all" && e.source !== f.host) return false;
    if (f.mode === "online" && !e.online) return false;
    if (f.mode === "inPerson" && e.online) return false;
    if (cutoff != null && new Date(e.startsAt).getTime() > cutoff) return false;
    return true;
  });
}

// Two decimals of a degree is about a kilometre: the same city typed two ways
// ("NYC", "New York, NY") geocodes close enough to land on one pin.
export function placeKey(a: { lat: number; lng: number }): string {
  return `${a.lat.toFixed(2)},${a.lng.toFixed(2)}`;
}

/** One place per pin, biggest first; labelled by its most common spelling. */
export function groupByPlace<T extends Located>(people: readonly T[]): ConnectPlace<T>[] {
  const places = new Map<string, ConnectPlace<T>>();
  for (const a of people) {
    const key = placeKey(a);
    const place = places.get(key) ?? {
      key,
      label: "",
      lat: a.lat,
      lng: a.lng,
      people: [],
      alumniCount: 0,
      studentCount: 0,
    };
    place.people.push(a);
    if (a.isStudent) place.studentCount += 1;
    else place.alumniCount += 1;
    places.set(key, place);
  }
  for (const place of places.values()) {
    const counts = new Map<string, number>();
    for (const a of place.people) counts.set(a.location, (counts.get(a.location) ?? 0) + 1);
    place.label = [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
  }
  return [...places.values()].sort(
    (x, y) => y.people.length - x.people.length || x.label.localeCompare(y.label),
  );
}

// The Web Mercator latitude where the tile world ends.
export const MAX_LAT = 85.0511;
const TILE_SIZE = 256;

/** Smallest zoom whose world is at least as tall as the map, so no grey shows above or below it. */
export function minZoomToFill(heightPx: number): number {
  return Math.max(2, Math.ceil(Math.log2(Math.max(heightPx, 1) / TILE_SIZE)));
}
