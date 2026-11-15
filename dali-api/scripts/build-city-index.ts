/**
 * Builds app/lib/places/cities5000.tsv.gz from GeoNames (CC BY 4.0, geonames.org).
 * Usage: npx tsx scripts/build-city-index.ts [workDir]
 * Downloads cities5000.zip, admin1CodesASCII.txt and countryInfo.txt into workDir
 * (default: a temp dir, removed afterwards) and writes the trimmed gzipped TSV.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BASE = "https://download.geonames.org/export/dump/";
const OUT = new URL("../app/lib/places/cities5000.tsv.gz", import.meta.url).pathname;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

async function download(name: string, dir: string) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  writeFileSync(join(dir, name), Buffer.from(await res.arrayBuffer()));
}

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), "geonames-"));
const cleanup = !process.argv[2];
try {
  for (const f of ["cities5000.zip", "admin1CodesASCII.txt", "countryInfo.txt"]) {
    await download(f, dir);
  }
  const cities = execFileSync("unzip", ["-p", join(dir, "cities5000.zip"), "cities5000.txt"], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf8");

  const admin1 = new Map<string, string>();
  for (const line of readFileSync(join(dir, "admin1CodesASCII.txt"), "utf8").split("\n")) {
    const [code, , ascii] = line.split("\t");
    if (code && ascii) admin1.set(code, ascii);
  }
  const countries = new Map<string, string>();
  for (const line of readFileSync(join(dir, "countryInfo.txt"), "utf8").split("\n")) {
    if (line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols[0] && cols[4]) countries.set(cols[0], cols[4]);
  }

  const rows: string[] = [];
  for (const line of cities.split("\n")) {
    const c = line.split("\t");
    if (c.length < 15) continue;
    const [id, name, asciiName, alts, lat, lng, , , cc, , a1, , , , pop] = c;
    const region = admin1.get(`${cc}.${a1}`) ?? "";
    const country = countries.get(cc) ?? cc;
    const seen = new Set([name.toLowerCase(), asciiName.toLowerCase()]);
    const altNames: string[] = [];
    for (const a of [asciiName, ...alts.split(",")]) {
      const key = a.trim().toLowerCase();
      if (!key || a.length > 24 || !PRINTABLE_ASCII.test(a) || seen.has(key)) continue;
      seen.add(key);
      altNames.push(a.trim());
    }
    rows.push([id, name, region, country, lat, lng, pop, altNames.join("|")].join("\t"));
  }
  writeFileSync(OUT, gzipSync(rows.join("\n") + "\n", { level: 9 }));
  console.log(`Wrote ${rows.length} cities to ${OUT}`);
} finally {
  if (cleanup) rmSync(dir, { recursive: true, force: true });
}
