/**
 * Import the Notion "Projects Showcase" database into ProjectShowcase rows —
 * the curated public face of a project that dali.website renders.
 *
 * Dry-run by default; pass --commit to write.
 *
 *   npx tsx scripts/import-project-showcase.ts --zip ./project-data/<export>.zip
 *   npx tsx scripts/import-project-showcase.ts --zip ./project-data/<export>.zip --commit
 *   npx tsx scripts/import-project-showcase.ts --zip ... --commit --images
 *
 * Idempotent: showcase rows are keyed on projectId, and created Projects are
 * matched by name on a re-run, so running twice updates rather than duplicates.
 *
 * Only fills fields that are empty in the DB — an operator edit in the app's
 * Public view always wins over the export, which is frozen history.
 *
 * --images is a separate pass: the Notion export contains only CSVs, no
 * attachments, so hero images are pulled live from the Notion API. It needs
 * NOTION_TOKEN (with access to the showcase database) and AWS credentials, and
 * can be run later, independently of the data import.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Papa from "papaparse";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { putObject } from "../app/lib/s3.js";
import {
  matchProject,
  normalizeName,
  toShowcaseFields,
  type ShowcaseFields,
  type ShowcaseRow,
} from "./lib/showcase-csv.js";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const WITH_IMAGES = args.includes("--images");
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  return value && !value.startsWith("--") ? value : undefined;
};

const zipPath = flagValue("--zip");
const csvPathArg = flagValue("--csv");

if (!zipPath && !csvPathArg) {
  console.error(
    "usage: import-project-showcase.ts (--zip <path> | --csv <path>) [--commit] [--images]",
  );
  process.exit(1);
}

// The Notion export is a zip containing a zip containing the CSVs. Rather than
// take a dependency for one archive, shell out to `unzip` — this is a one-off
// migration script, not app code.
function csvFromZip(path: string): string {
  const dir = mkdtempSync(join(tmpdir(), "showcase-"));
  execFileSync("unzip", ["-o", "-q", path, "-d", dir]);
  const inner = readdirSync(dir).find((f) => f.endsWith(".zip"));
  if (inner) execFileSync("unzip", ["-o", "-q", join(dir, inner), "-d", dir]);

  // Two CSVs ship in the export: the default view (12 columns) and `_all` (13,
  // including Logo Image). Always take `_all` — the other one drops a column.
  const found: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith("_all.csv")) found.push(full);
    }
  };
  walk(dir);
  if (found.length !== 1) {
    console.error(
      `expected exactly one *_all.csv in the export, found ${found.length}`,
    );
    process.exit(1);
  }
  return found[0]!;
}

type Plan = {
  showcaseName: string;
  fields: ShowcaseFields;
  match: ReturnType<typeof matchProject>;
};

// Pull hero images from the live Notion database, keyed by normalized project
// name. The CSV records a relative attachment path ("Projects Showcase/
// Frame_266.png") but the export ships no files, so the bytes only exist in
// Notion.
async function notionImagesByName(): Promise<Map<string, string>> {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error("--images needs NOTION_TOKEN (read access to the showcase database)");
    process.exit(1);
  }
  const DATABASE_ID = "9bbcc845675f4ace99c4a91112a89d78";
  const byName = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
      },
    );
    if (!res.ok) {
      console.error(`Notion query failed: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const body = (await res.json()) as {
      results: any[];
      has_more: boolean;
      next_cursor: string | null;
    };
    for (const page of body.results) {
      const name = (page.properties?.["Project Name"]?.rich_text ?? [])
        .map((t: any) => t.plain_text)
        .join("")
        .trim();
      if (!name) continue;
      // Page cover wins over the Logo Image property, matching how the old
      // dali.website resolved a project's image.
      const logo = page.properties?.["Logo Image"]?.files?.[0];
      const url =
        page.cover?.file?.url ??
        page.cover?.external?.url ??
        logo?.file?.url ??
        logo?.external?.url;
      if (url) byName.set(normalizeName(name), url);
    }
    cursor = body.has_more ? (body.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return byName;
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function uploadImage(projectId: string, url: string): Promise<string | null> {
  // Notion's file URLs are presigned and short-lived, which is exactly why the
  // bytes get copied into our own bucket rather than linked.
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`    image fetch failed (${res.status})`);
    return null;
  }
  const contentType = res.headers.get("content-type")?.split(";")[0] ?? "";
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) {
    console.warn(`    unsupported image type "${contentType}"`);
    return null;
  }
  // putObject takes the key verbatim, so the `uploads/` prefix is ours to
  // supply — everything the app serves back (resolvePhotoUrl, the public
  // media route) keys off it.
  const key = `uploads/showcase/${projectId}.${ext}`;
  await putObject(key, new Uint8Array(await res.arrayBuffer()), contentType);
  return key;
}

async function main() {
  const csvPath = zipPath ? csvFromZip(zipPath) : csvPathArg!;
  const text = readFileSync(csvPath, "utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<ShowcaseRow>(text, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) {
    console.error(`CSV parse errors (${parsed.errors.length}), first 3:`);
    for (const e of parsed.errors.slice(0, 3)) {
      console.error(`  row ${e.row}: ${e.message}`);
    }
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  const byNormalizedName = new Map(
    projects.map((p) => [normalizeName(p.name), p]),
  );

  const plans: Plan[] = parsed.data.map((row) => {
    const fields = toShowcaseFields(row);
    return {
      showcaseName: fields.displayName,
      fields,
      match: matchProject(fields.displayName, byNormalizedName),
    };
  });

  // ── Report ────────────────────────────────────────────────────────────────
  const counts = { exact: 0, alias: 0, create: 0, skip: 0 };
  console.log(`\nParsed ${plans.length} showcase rows from ${csvPath}\n`);
  for (const plan of plans) {
    counts[plan.match.kind]++;
    const status = plan.fields.status.padEnd(11);
    switch (plan.match.kind) {
      case "exact":
        break;
      case "alias":
        console.log(`  ALIAS  ${status} ${plan.showcaseName} → ${plan.match.projectName}`);
        break;
      case "create":
        console.log(`  CREATE ${status} ${plan.showcaseName} (no project in DB)`);
        break;
      case "skip":
        console.log(`  SKIP   ${status} "${plan.showcaseName}" — ${plan.match.reason}`);
        break;
    }
  }
  console.log(
    `\n  ${counts.exact} matched by name, ${counts.alias} by alias, ` +
      `${counts.create} projects to create, ${counts.skip} skipped`,
  );
  const published = plans.filter((p) => p.fields.status === "Published").length;
  console.log(`  ${published} rows are Published and will appear on dali.website\n`);

  if (!COMMIT) {
    console.log("Dry run — pass --commit to write.\n");
    await prisma.$disconnect();
    return;
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  let created = 0;
  let written = 0;
  const projectIdByName = new Map<string, string>();

  for (const plan of plans) {
    if (plan.match.kind === "skip") continue;

    let projectId: string;
    if (plan.match.kind === "create") {
      // Historical projects that predate DALI OS. Archived with no terms,
      // roster, or tasks — they exist so the showcase row has a hub page to be
      // edited from, not to imply the lab is running them.
      const project = await prisma.project.create({
        data: { name: plan.showcaseName, status: "Archived" },
        select: { id: true },
      });
      projectId = project.id;
      created++;
    } else {
      projectId = plan.match.projectId;
    }
    projectIdByName.set(normalizeName(plan.showcaseName), projectId);

    const f = plan.fields;
    const existing = await prisma.projectShowcase.findUnique({
      where: { projectId },
    });

    // Fill-if-empty: a curator's edit in the app outranks the frozen export.
    // Status is the exception — it's the publish gate, and on a first import
    // there is nothing to overwrite anyway.
    const data = {
      status: existing ? existing.status : f.status,
      displayName: existing?.displayName ?? f.displayName,
      tagline: existing?.tagline ?? f.tagline,
      year: existing?.year ?? f.year,
      partners: existing?.partners.length ? existing.partners : f.partners,
      products: existing?.products.length ? existing.products : f.products,
      sectors: existing?.sectors.length ? existing.sectors : f.sectors,
      techStack: existing?.techStack.length ? existing.techStack : f.techStack,
      appUrl: existing?.appUrl ?? f.appUrl,
      websiteUrl: existing?.websiteUrl ?? f.websiteUrl,
      blogUrl: existing?.blogUrl ?? f.blogUrl,
      pressUrl: existing?.pressUrl ?? f.pressUrl,
    };

    await prisma.projectShowcase.upsert({
      where: { projectId },
      create: { projectId, ...data },
      update: data,
    });
    written++;
  }

  console.log(`Wrote ${written} showcase rows (${created} projects created).`);

  // ── Images ────────────────────────────────────────────────────────────────
  if (WITH_IMAGES) {
    console.log("\nFetching hero images from Notion...");
    const images = await notionImagesByName();
    console.log(`  ${images.size} projects have an image in Notion`);

    let uploaded = 0;
    for (const [normalized, projectId] of projectIdByName) {
      const url = images.get(normalized);
      if (!url) continue;
      const existing = await prisma.projectShowcase.findUnique({
        where: { projectId },
        select: { heroImageUrl: true },
      });
      if (existing?.heroImageUrl) continue;

      console.log(`  ${normalized}`);
      const key = await uploadImage(projectId, url);
      if (!key) continue;
      await prisma.projectShowcase.update({
        where: { projectId },
        data: { heroImageUrl: key },
      });
      uploaded++;
    }
    console.log(`Uploaded ${uploaded} hero images.`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
