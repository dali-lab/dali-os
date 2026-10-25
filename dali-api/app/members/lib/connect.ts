// Connect map: alumni who share a place share a pin. Client-safe.

export type ConnectAlum = {
  id: string;
  name: string;
  photoUrl: string | null;
  classYear: number | null;
  location: string;
  lat: number;
  lng: number;
  /** "Position at Company" for their current job, if they list one. */
  currentJob: string | null;
};

export type ConnectPlace = {
  key: string;
  label: string;
  lat: number;
  lng: number;
  alumni: ConnectAlum[];
};

// Two decimals of a degree is about a kilometre: the same city typed two ways
// ("NYC", "New York, NY") geocodes close enough to land on one pin.
function placeKey(a: { lat: number; lng: number }): string {
  return `${a.lat.toFixed(2)},${a.lng.toFixed(2)}`;
}

/** One place per pin, biggest first; labelled by its most common spelling. */
export function groupByPlace(alumni: readonly ConnectAlum[]): ConnectPlace[] {
  const places = new Map<string, ConnectPlace>();
  for (const a of alumni) {
    const key = placeKey(a);
    const place = places.get(key) ?? { key, label: "", lat: a.lat, lng: a.lng, alumni: [] };
    place.alumni.push(a);
    places.set(key, place);
  }
  for (const place of places.values()) {
    const counts = new Map<string, number>();
    for (const a of place.alumni) counts.set(a.location, (counts.get(a.location) ?? 0) + 1);
    place.label = [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
  }
  return [...places.values()].sort(
    (x, y) => y.alumni.length - x.alumni.length || x.label.localeCompare(y.label),
  );
}

// The Web Mercator latitude where the tile world ends.
export const MAX_LAT = 85.0511;
const TILE_SIZE = 256;

/** Smallest zoom whose world is at least as tall as the map, so no grey shows above or below it. */
export function minZoomToFill(heightPx: number): number {
  return Math.max(2, Math.ceil(Math.log2(Math.max(heightPx, 1) / TILE_SIZE)));
}

export type ProfileFields = {
  photo: boolean;
  job: boolean;
  location: boolean;
  bio: boolean;
  classYear: boolean;
};

const FIELD_ASKS: Record<keyof ProfileFields, string> = {
  photo: "a photo",
  job: "your employer",
  location: "where you're based",
  bio: "a short bio",
  classYear: "your class year",
};

function joinAsks(asks: string[]): string {
  if (asks.length <= 1) return asks.join("");
  return `${asks.slice(0, -1).join(", ")} and ${asks[asks.length - 1]}`;
}

/** The alumni "Your profile" bar: each field is an equal share, and the hint asks for what's missing. */
export function profileCompleteness(fields: ProfileFields): { percent: number; hint: string | null } {
  const keys = Object.keys(FIELD_ASKS) as (keyof ProfileFields)[];
  const missing = keys.filter((k) => !fields[k]);
  const percent = Math.round(((keys.length - missing.length) / keys.length) * 100);
  const hint = missing.length
    ? `Add ${joinAsks(missing.map((k) => FIELD_ASKS[k]))} so students can find you.`
    : null;
  return { percent, hint };
}
