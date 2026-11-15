import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  buildIndex,
  cityById,
  searchIndex,
  type CityHit,
  type CityIndex,
  type CityRow,
} from "./city-search";

const FILE = resolve(process.cwd(), "app/lib/places/cities5000.tsv.gz");

export function parseCities(tsv: string): CityRow[] {
  const rows: CityRow[] = [];
  for (const line of tsv.split("\n")) {
    if (!line) continue;
    const [id, name, region, country, lat, lng, population, alts] = line.split("\t");
    rows.push({
      geonameId: Number(id),
      name,
      region,
      country,
      lat: Number(lat),
      lng: Number(lng),
      population: Number(population),
      alts: alts ? alts.split("|") : [],
    });
  }
  return rows;
}

let index: CityIndex | null = null;

export function cityIndex(): CityIndex {
  index ??= buildIndex(parseCities(gunzipSync(readFileSync(FILE)).toString("utf8")));
  return index;
}

export function searchCities(
  query: string,
  opts: { boostGeonameIds?: ReadonlySet<number>; limit?: number } = {},
): CityHit[] {
  return searchIndex(cityIndex(), query, opts);
}

export function getCity(geonameId: number) {
  return cityById(cityIndex(), geonameId);
}
