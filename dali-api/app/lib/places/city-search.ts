export type CityRow = {
  geonameId: number;
  name: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  population: number;
  alts: string[];
};

export type CityHit = {
  geonameId: number;
  name: string;
  region: string;
  country: string;
  label: string;
};

type IndexedCity = CityRow & { nameKey: string; altKeys: string[] };

export type CityIndex = {
  cities: IndexedCity[];
  byId: Map<number, IndexedCity>;
  aliasIds: Map<string, number>;
};

const NICKNAMES: Array<{ alias: string; name: string; region: string; country: string }> = [
  { alias: "nyc", name: "New York City", region: "New York", country: "United States" },
  { alias: "dc", name: "Washington", region: "District of Columbia", country: "United States" },
  { alias: "sf", name: "San Francisco", region: "California", country: "United States" },
  { alias: "la", name: "Los Angeles", region: "California", country: "United States" },
  { alias: "philly", name: "Philadelphia", region: "Pennsylvania", country: "United States" },
];

const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
  ct: "connecticut", de: "delaware", dc: "district of columbia", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas",
  ky: "kentucky", la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts",
  mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana",
  ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico",
  ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma",
  or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota",
  tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};

const COUNTRY_ALIASES: Record<string, string> = {
  us: "united states",
  usa: "united states",
  "u s": "united states",
  "u s a": "united states",
  america: "united states",
  uk: "united kingdom",
  england: "united kingdom",
  scotland: "united kingdom",
};

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function cityLabel(c: { name: string; region: string; country: string }): string {
  return [c.name, c.region, c.country].filter(Boolean).join(", ");
}

function toHit(c: CityRow): CityHit {
  return {
    geonameId: c.geonameId,
    name: c.name,
    region: c.region,
    country: c.country,
    label: cityLabel(c),
  };
}

export function buildIndex(rows: CityRow[]): CityIndex {
  const cities = rows.map((r) => ({
    ...r,
    nameKey: normalize(r.name),
    altKeys: r.alts.map(normalize).filter(Boolean),
  }));
  const byId = new Map(cities.map((c) => [c.geonameId, c]));
  const aliasIds = new Map<string, number>();
  for (const n of NICKNAMES) {
    const city = cities.find(
      (c) => c.name === n.name && c.region === n.region && c.country === n.country,
    );
    if (city) aliasIds.set(n.alias, city.geonameId);
  }
  return { cities, byId, aliasIds };
}

/** 0: name starts with the query, 1: a later word of the name does, 2/3: same for alternate names. */
function tierOf(c: IndexedCity, tokens: string[]): number | null {
  const first = prefixMatch(c.nameKey, tokens);
  if (first === 0) return 0;
  if (first > 0) return 1;
  let best: number | null = null;
  for (const alt of c.altKeys) {
    const at = prefixMatch(alt, tokens);
    if (at === 0) return 2;
    if (at > 0) best = 3;
  }
  return best;
}

/** Index of the first word where the tokens match consecutive word prefixes, or -1. */
function prefixMatch(key: string, tokens: string[]): number {
  const words = key.split(" ");
  for (let start = 0; start + tokens.length <= words.length; start++) {
    if (tokens.every((t, i) => words[start + i].startsWith(t))) return start;
  }
  return -1;
}

export function searchIndex(
  index: CityIndex,
  query: string,
  { boostGeonameIds, limit = 6 }: { boostGeonameIds?: ReadonlySet<number>; limit?: number } = {},
): CityHit[] {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(" ");
  const aliasId = index.aliasIds.get(q);
  const ranked: Array<{ c: IndexedCity; boosted: boolean; tier: number }> = [];
  for (const c of index.cities) {
    const tier = c.geonameId === aliasId ? -1 : tierOf(c, tokens);
    if (tier === null) continue;
    ranked.push({ c, boosted: boostGeonameIds?.has(c.geonameId) ?? false, tier });
  }
  ranked.sort(
    (a, b) =>
      Number(b.boosted) - Number(a.boosted) ||
      a.tier - b.tier ||
      b.c.population - a.c.population,
  );
  return ranked.slice(0, limit).map((r) => toHit(r.c));
}

export function cityById(index: CityIndex, id: number): (CityRow & { label: string }) | null {
  const c = index.byId.get(id);
  return c ? { ...c, label: cityLabel(c) } : null;
}

function agrees(part: string, c: CityRow): boolean {
  const p = normalize(part);
  const region = normalize(c.region);
  const country = normalize(c.country);
  const stateName = c.country === "United States" ? US_STATES[p] : undefined;
  const countryName = COUNTRY_ALIASES[p] ?? p;
  return (
    p === region ||
    p === country ||
    countryName === country ||
    (stateName !== undefined && stateName === region)
  );
}

/** The city a free-text "City, Region, Country" most confidently means, or null. */
export function matchFreeText(index: CityIndex, text: string): CityRow | null {
  const [head, ...rest] = text.split(",").map((s) => s.trim()).filter(Boolean);
  if (!head) return null;
  const key = normalize(head);
  const aliasId = rest.length === 0 ? index.aliasIds.get(key) : undefined;
  if (aliasId !== undefined) return index.byId.get(aliasId) ?? null;
  const pool = index.cities.filter((c) => c.nameKey === key || c.altKeys.includes(key));
  const fits = pool.filter((c) => rest.every((part) => agrees(part, c)));
  const byName = fits.filter((c) => c.nameKey === key);
  const best = (byName.length ? byName : fits).sort((a, b) => b.population - a.population)[0];
  return best ?? null;
}
