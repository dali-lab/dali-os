/**
 * Seed ProjectShowcase.details from the old public write-up documents.
 *
 * The public write-up used to be a free-text collab page (the project page
 * flagged publicVisible); it's now structured { item, description } pairs. This
 * reads each showcase's write-up doc and splits it into pairs on its headings —
 * a heading becomes an `item`, the text under it becomes the `description` —
 * so the current Problem / Solution / Impact structure carries over.
 *
 * Best-effort by design: a free-form doc won't map perfectly, and Core can
 * fix any project in the Public view afterward. Non-destructive — skips a
 * showcase that already has details (re-runnable), unless --force is passed.
 *
 * Dry-run by default; prints what it would write.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-showcase-details.ts            # dry run
 *   npx tsx --env-file .env scripts/backfill-showcase-details.ts --commit   # write
 *   npx tsx --env-file .env scripts/backfill-showcase-details.ts --commit --force
 */

import { prisma } from "../app/lib/db.js";
import { readDocAsBlocks } from "../app/collab/read.js";
import { parseDetails, type ShowcaseDetail } from "../app/projects/lib/showcase-content.js";
import type { DocBlock } from "../app/collab/blocknote-server.js";

const commit = process.argv.includes("--commit");
const force = process.argv.includes("--force");

// Flatten a block tree into document order (block, then its children). Columns
// store their heading/callout content as children, so a two-column
// Problem | Solution layout linearizes into Problem, Solution here.
function flatten(blocks: DocBlock[]): DocBlock[] {
  const out: DocBlock[] = [];
  for (const b of blocks) {
    out.push(b);
    if (Array.isArray(b.children) && b.children.length > 0) {
      out.push(...flatten(b.children));
    }
  }
  return out;
}

// Best-effort inline text for a block, recursing through nested runs and table
// cells. Good enough to recover a write-up's prose; not a faithful renderer.
function inlineText(content: DocBlock["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((node) => {
        if (node && typeof node === "object") {
          if (typeof node.text === "string") return node.text;
          if (node.content) return inlineText(node.content as DocBlock["content"]);
        }
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object" && "rows" in content) {
    return content.rows
      .map((row) =>
        (row.cells ?? [])
          .map((cell) => inlineText(Array.isArray(cell) ? cell : cell.content))
          .join("  |  "),
      )
      .join("\n");
  }
  return "";
}

function blocksToPairs(blocks: DocBlock[]): ShowcaseDetail[] {
  const pairs: ShowcaseDetail[] = [];
  let current: ShowcaseDetail | null = null;
  const flush = () => {
    if (current) pairs.push(current);
    current = null;
  };

  for (const block of flatten(blocks)) {
    const text = inlineText(block.content).trim();
    if (block.type === "heading") {
      flush();
      // The site adds its own colon and weight, so strip a trailing one.
      current = { item: text.replace(/[:：]\s*$/, "").trim(), description: "" };
    } else if (text) {
      if (!current) current = { item: "", description: "" };
      current.description += (current.description ? "\n\n" : "") + text;
    }
  }
  flush();

  // parseDetails drops rows blank on both fields and normalizes the shape.
  return parseDetails(pairs);
}

async function main() {
  const showcases = await prisma.projectShowcase.findMany({
    select: {
      id: true,
      projectId: true,
      details: true,
      project: { select: { name: true } },
    },
  });

  console.log(
    `${showcases.length} showcase row(s). ${commit ? "COMMITTING" : "Dry run"}${force ? " (force)" : ""}.\n`,
  );

  let seeded = 0;
  let skippedHasDetails = 0;
  let skippedEmptyDoc = 0;

  for (const sc of showcases) {
    const label = sc.project.name;

    if (!force && parseDetails(sc.details).length > 0) {
      skippedHasDetails++;
      continue;
    }

    const page = await prisma.page.findFirst({
      where: {
        workspaceType: "Project",
        workspaceId: sc.projectId,
        archivedAt: null,
        publicVisible: true,
      },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (!page) {
      skippedEmptyDoc++;
      continue;
    }

    const blocks = await readDocAsBlocks(`doc:${page.id}:body`);
    const pairs = blocksToPairs(blocks);
    if (pairs.length === 0) {
      skippedEmptyDoc++;
      continue;
    }

    console.log(`• ${label} — ${pairs.length} section(s):`);
    for (const p of pairs) {
      const preview = p.description.replace(/\s+/g, " ").slice(0, 70);
      console.log(`    ${p.item || "(no heading)"} — ${preview}${p.description.length > 70 ? "…" : ""}`);
    }

    if (commit) {
      await prisma.projectShowcase.update({
        where: { id: sc.id },
        data: { details: pairs },
      });
    }
    seeded++;
  }

  console.log(
    `\n${commit ? "Seeded" : "Would seed"} ${seeded} • skipped ${skippedHasDetails} with details • skipped ${skippedEmptyDoc} with no usable write-up.`,
  );
  if (!commit && seeded > 0) console.log("Re-run with --commit to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
