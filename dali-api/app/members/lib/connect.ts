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
