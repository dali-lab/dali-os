// Community map: people who share a place share a pin. Client-safe.

export const HANOVER = { label: "Hanover, NH", lat: 43.7044, lng: -72.2887 } as const;
export const NEARBY_KM = 50;

export type Activity = "today" | "week" | null;

export type CommunityPerson = {
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

export type CommunityAlum = Pick<
  CommunityPerson,
  "id" | "name" | "photoUrl" | "classYear" | "location" | "lat" | "lng" | "currentJob"
> &
  Partial<CommunityPerson>;

type Located = { id: string; location: string; lat: number; lng: number; isStudent?: boolean };

export type CommunityPlace<T extends Located = CommunityAlum> = {
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

function placeLabel(u: {
  currentLocation: string | null;
  currentLocationCity?: string | null;
  currentLocationRegion?: string | null;
}): string | null {
  const parts = [u.currentLocationCity, u.currentLocationRegion].filter(Boolean);
  return parts.length ? parts.join(", ") : u.currentLocation;
}

/** Where a person pins: their own spot, or Hanover for a student who hasn't set one. */
export function locatePerson(u: {
  isStudent: boolean;
  currentLocation: string | null;
  currentLocationCity?: string | null;
  currentLocationRegion?: string | null;
  currentLocationLat: number | null;
  currentLocationLng: number | null;
}): { location: string; lat: number; lng: number } | null {
  if (u.currentLocationLat != null && u.currentLocationLng != null) {
    return {
      location: placeLabel(u) || HANOVER.label,
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

export function filterPeople(people: readonly CommunityPerson[], f: PeopleFilters): CommunityPerson[] {
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

export type CommunityViewer = {
  classYear: number | null;
  projectIds: string[];
  lat: number | null;
  lng: number | null;
};

/** The one teal line under a row: what you share with them. */
export function whyLine(
  p: Pick<CommunityPerson, "projects" | "isStudent" | "classYear">,
  viewer: CommunityViewer,
): string | null {
  const shared = p.projects.find((pr) => viewer.projectIds.includes(pr.id));
  if (shared) {
    return p.isStudent ? "On your old project" : `Also on ${shared.name}, ${shared.term}`;
  }
  if (p.classYear != null && p.classYear === viewer.classYear) return "Your class";
  return null;
}

export function isNearViewer(p: { lat: number; lng: number }, viewer: CommunityViewer): boolean {
  if (viewer.lat == null || viewer.lng == null) return false;
  return haversineKm(p, { lat: viewer.lat, lng: viewer.lng }) <= NEARBY_KM;
}

function matchScore(p: CommunityPerson, viewer: CommunityViewer): number {
  let score = 0;
  if (p.projects.some((pr) => viewer.projectIds.includes(pr.id))) score += 4;
  if (p.classYear != null && p.classYear === viewer.classYear) score += 2;
  if (isNearViewer(p, viewer)) score += 1;
  return score;
}

export function sortPeople(
  people: readonly CommunityPerson[],
  by: "match" | "name",
  viewer: CommunityViewer,
): CommunityPerson[] {
  const byName = (a: CommunityPerson, b: CommunityPerson) => a.name.localeCompare(b.name);
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
export function groupByPlace<T extends Located>(people: readonly T[]): CommunityPlace<T>[] {
  const places = new Map<string, CommunityPlace<T>>();
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

export const MAP_TILES_ORIGIN = "https://tiles.openfreemap.org";
const WORLD_PX_AT_ZOOM_0 = 512;

/** Smallest zoom whose world is at least as tall as the map, so no blank shows above or below it. */
export function minZoomToFill(heightPx: number): number {
  return Math.max(1, Math.log2(Math.max(heightPx, 1) / WORLD_PX_AT_ZOOM_0));
}

export const CLUSTER_RADIUS_PX = 64;
export const HOME_ZOOM = 7;

function worldPx(p: { lat: number; lng: number }, zoom: number): { x: number; y: number; size: number } {
  const size = WORLD_PX_AT_ZOOM_0 * 2 ** zoom;
  const sin = Math.sin((Math.max(-85.0511, Math.min(85.0511, p.lat)) * Math.PI) / 180);
  return {
    x: ((p.lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
    size,
  };
}

/**
 * Places close enough on screen at this zoom to draw as one pin. The biggest
 * place anchors each cluster and comes first, so the pin sits on a real city.
 */
export function clusterPlaces<P extends { key: string; lat: number; lng: number; people: readonly unknown[] }>(
  places: readonly P[],
  zoom: number,
  radiusPx: number = CLUSTER_RADIUS_PX,
): P[][] {
  const ranked = [...places].sort((a, b) => b.people.length - a.people.length || a.key.localeCompare(b.key));
  const px = new Map(ranked.map((p) => [p.key, worldPx(p, zoom)]));
  const taken = new Set<string>();
  const clusters: P[][] = [];
  for (const anchor of ranked) {
    if (taken.has(anchor.key)) continue;
    const a = px.get(anchor.key)!;
    const cluster = [anchor];
    taken.add(anchor.key);
    for (const p of ranked) {
      if (taken.has(p.key)) continue;
      const b = px.get(p.key)!;
      const dx = Math.abs(a.x - b.x);
      if (Math.hypot(Math.min(dx, a.size - dx), a.y - b.y) > radiusPx) continue;
      cluster.push(p);
      taken.add(p.key);
    }
    clusters.push(cluster);
  }
  return clusters;
}

/** "Boston, MA", or "Boston, MA and 2 more places" for a cluster. */
export function placesLabel(places: readonly { label: string; people: readonly unknown[] }[]): string {
  const [first, ...rest] = [...places].sort((a, b) => b.people.length - a.people.length);
  if (rest.length === 0) return first.label;
  return `${first.label} and ${rest.length} more ${rest.length === 1 ? "place" : "places"}`;
}

export function countPeopleFilters(f: PeopleFilters): number {
  return [
    f.who !== "all",
    f.classYears.length > 0,
    f.roles.length > 0,
    f.projectIds.length > 0,
    f.openTo.length > 0,
    f.activeThisWeek,
  ].filter(Boolean).length;
}

export const DEFAULT_EVENT_WINDOW_DAYS = 90;

export function countEventFilters(f: Pick<EventFilters, "host" | "mode" | "withinDays">): number {
  return [f.withinDays !== DEFAULT_EVENT_WINDOW_DAYS, f.host !== "all", f.mode !== "all"].filter(Boolean).length;
}

export const AREA_KM = 40;
export const SUGGEST_MIN_CHARS = 2;
export const SUGGEST_MAX_PEOPLE = 3;

type PlaceLike = { key: string; label: string; lat: number; lng: number; people: readonly unknown[] };

export type PlaceSuggestions<P extends PlaceLike = PlaceLike> = {
  area: { name: string; keys: string[]; subline: string; count: number } | null;
  places: { key: string; label: string; count: number; place: P }[];
};

const byBiggest = (a: PlaceLike, b: PlaceLike) => b.people.length - a.people.length || a.label.localeCompare(b.label);

/** The places within `km` of an anchor, biggest first, anchor included. */
export function placesWithin<P extends PlaceLike>(places: readonly P[], anchor: P, km: number = AREA_KM): P[] {
  return places.filter((p) => p.key === anchor.key || haversineKm(p, anchor) <= km).sort(byBiggest);
}

/**
 * Places whose label matches what was typed, plus an area row when the best
 * match has other places within 40 km: picking it selects all of them.
 */
export function suggestPlaces<P extends PlaceLike>(places: readonly P[], query: string): PlaceSuggestions<P> {
  const q = query.trim().toLowerCase();
  if (q.length < SUGGEST_MIN_CHARS) return { area: null, places: [] };
  const matches = places
    .filter((p) => p.label.toLowerCase().includes(q))
    .sort((a, b) => {
      const starts = Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q));
      return starts || byBiggest(a, b);
    });
  if (matches.length === 0) return { area: null, places: [] };
  const best = matches[0];
  const members = placesWithin(places, best);
  const others = members.filter((p) => p.key !== best.key);
  const area =
    others.length === 0
      ? null
      : {
          name: best.label,
          keys: members.map((p) => p.key),
          subline:
            others.length > 3
              ? `${others.slice(0, 3).map((p) => p.label).join(", ")} and ${others.length - 3} more`
              : others.map((p) => p.label).join(", "),
          count: members.reduce((n, p) => n + p.people.length, 0),
        };
  return {
    area,
    places: matches.map((p) => ({ key: p.key, label: p.label, count: p.people.length, place: p })),
  };
}

export function suggestPeople<T extends Pick<CommunityPerson, "name" | "currentJob">>(
  people: readonly T[],
  query: string,
  limit: number = SUGGEST_MAX_PEOPLE,
): T[] {
  const q = query.trim().toLowerCase();
  if (q.length < SUGGEST_MIN_CHARS) return [];
  return people.filter((p) => `${p.name} ${p.currentJob ?? ""}`.toLowerCase().includes(q)).slice(0, limit);
}

export type EdgeSide = "left" | "right" | "top" | "bottom";
export type EdgeView = {
  center: { lat: number; lng: number };
  bounds: MapBounds;
  width: number;
  height: number;
};
export type EdgePosition = { x: number; y: number; side: EdgeSide };

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));
const wrapLng = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Where a place outside the view sits on the map's edge: on the line from the
 * map's centre toward it, inset from the border. Null when it is in view.
 */
export function edgePosition(view: EdgeView, place: { lat: number; lng: number }, inset = 20): EdgePosition | null {
  const { center, bounds, width, height } = view;
  const spanLng = bounds.east - bounds.west + (bounds.west <= bounds.east ? 0 : 360);
  const spanY = mercY(bounds.north) - mercY(bounds.south);
  if (width <= 0 || height <= 0 || spanLng <= 0 || spanY <= 0) return null;
  const dx = (wrapLng(place.lng - center.lng) / spanLng) * width;
  const dy = ((mercY(center.lat) - mercY(place.lat)) / spanY) * height;
  const limitX = width / 2 - inset;
  const limitY = height / 2 - inset;
  if (Math.abs(dx) <= limitX && Math.abs(dy) <= limitY) return null;
  const t = Math.min(dx === 0 ? Infinity : limitX / Math.abs(dx), dy === 0 ? Infinity : limitY / Math.abs(dy));
  const side: EdgeSide =
    Math.abs(dx) / limitX >= Math.abs(dy) / limitY ? (dx < 0 ? "left" : "right") : dy < 0 ? "top" : "bottom";
  return { x: width / 2 + dx * t, y: height / 2 + dy * t, side };
}

export type EdgePin = EdgePosition & { key: string; label: string; count: number };
export type MergedEdgePin = EdgePin & { keys: string[] };

/** Pins whose bubbles would overlap become one: counts add up, the biggest place names it. */
export function mergeEdgePins(pins: readonly EdgePin[], minGapPx: number = 26): MergedEdgePin[] {
  const ranked = [...pins].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const merged: MergedEdgePin[] = [];
  for (const pin of ranked) {
    const home = merged.find((m) => Math.hypot(m.x - pin.x, m.y - pin.y) < minGapPx);
    if (home) {
      home.count += pin.count;
      home.keys.push(pin.key);
    } else {
      merged.push({ ...pin, keys: [pin.key] });
    }
  }
  return merged;
}
