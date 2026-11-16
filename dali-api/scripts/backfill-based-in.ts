/**
 * Fills the structured "Based in" columns (city, region, country, geoname id,
 * coordinates) for members whose currentLocation is free text.
 *
 * Each row is matched against the bundled city list first; anything the list
 * cannot place confidently goes to Nominatim at no more than one request a
 * second. Rows with no match are only reported, never changed.
 *
 * Dry run by default; pass --apply to write.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-based-in.ts
 *   npx tsx --env-file .env scripts/backfill-based-in.ts --apply
 */
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { geocodePlace } from "../app/lib/geocode.server.js";
import { cityIndex } from "../app/lib/places/cities.server.js";
import { cityLabel, matchFreeText } from "../app/lib/places/city-search.js";

const APPLY = process.argv.includes("--apply");
const NOMINATIM_GAP_MS = 1100;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type Update = {
  currentLocation?: string;
  currentLocationLat: number;
  currentLocationLng: number;
  currentLocationCity: string | null;
  currentLocationRegion: string | null;
  currentLocationCountry: string | null;
  currentLocationGeonameId: number | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(APPLY ? "APPLY mode: rows will be written.\n" : "Dry run: nothing is written. Pass --apply to write.\n");
  const users = await prisma.user.findMany({
    where: { currentLocation: { not: null }, currentLocationGeonameId: null },
    select: { id: true, currentLocation: true, currentLocationLat: true, currentLocationCity: true },
    orderBy: { id: "asc" },
  });
  const index = cityIndex();
  const byIndex: string[] = [];
  const byNominatim: string[] = [];
  const unmatched: string[] = [];
  let lastNominatim = 0;

  for (const u of users) {
    const text = (u.currentLocation ?? "").trim();
    if (!text) continue;
    let update: Update | null = null;
    const city = matchFreeText(index, text);
    if (city) {
      update = {
        currentLocation: cityLabel(city),
        currentLocationLat: city.lat,
        currentLocationLng: city.lng,
        currentLocationCity: city.name,
        currentLocationRegion: city.region || null,
        currentLocationCountry: city.country,
        currentLocationGeonameId: city.geonameId,
      };
      byIndex.push(`${text}  ->  ${cityLabel(city)}`);
    } else if (u.currentLocationCity == null) {
      await sleep(Math.max(0, lastNominatim + NOMINATIM_GAP_MS - Date.now()));
      const found = await geocodePlace(text);
      lastNominatim = Date.now();
      if (found) {
        update = {
          currentLocationLat: found.lat,
          currentLocationLng: found.lng,
          currentLocationCity: found.city,
          currentLocationRegion: found.region,
          currentLocationCountry: found.country,
          currentLocationGeonameId: null,
        };
        byNominatim.push(`${text}  ->  ${[found.city, found.region, found.country].filter(Boolean).join(", ")}`);
      }
    }
    if (!update) {
      unmatched.push(text);
      continue;
    }
    if (APPLY) await prisma.user.update({ where: { id: u.id }, data: update });
  }

  const section = (title: string, lines: string[]) => {
    console.log(`${title} (${lines.length})`);
    for (const l of lines) console.log(`  ${l}`);
    console.log();
  };
  section("Matched by city list", byIndex);
  section("Matched by Nominatim", byNominatim);
  section("Unmatched", unmatched);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
