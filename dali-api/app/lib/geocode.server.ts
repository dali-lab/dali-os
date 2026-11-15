// Place name → coordinates and address parts, for the Community map. OpenStreetMap's
// Nominatim: free and keyless, but its usage policy wants an identifying User-Agent and
// low volume, so this is only called when someone saves a changed location.
// Never throws: a lookup that fails or finds nothing just means no pin.

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

export const NOMINATIM_USER_AGENT = "DALI OS (dali.dartmouth.edu)";

export type GeocodeResult = {
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country: string | null;
};

type NominatimHit = {
  lat?: string;
  lon?: string;
  address?: Record<string, string | undefined>;
};

export function parseNominatimHit(hit: NominatimHit | undefined): GeocodeResult | null {
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const a = hit.address ?? {};
  return {
    lat,
    lng,
    city: a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? null,
    region: a.state ?? a.region ?? null,
    country: a.country ?? null,
  };
}

export async function geocodePlace(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const res = await fetch(
      `${ENDPOINT}?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(q)}`,
      {
        headers: { "User-Agent": NOMINATIM_USER_AGENT, "Accept-Language": "en" },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) return null;
    const [hit] = (await res.json()) as NominatimHit[];
    return parseNominatimHit(hit);
  } catch {
    return null;
  }
}
