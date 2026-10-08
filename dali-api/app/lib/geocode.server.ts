// Place name → coordinates, for the Connect map. OpenStreetMap's Nominatim:
// free and keyless, but its usage policy wants an identifying User-Agent and
// low volume, so this is only called when someone saves a changed location.
// Never throws: a lookup that fails or finds nothing just means no pin.

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

export async function geocodePlace(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const res = await fetch(`${ENDPOINT}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": "DALI OS (dali.dartmouth.edu)", "Accept-Language": "en" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
