// Batch warmer/sweep for the TipTap → BlockNote migration. The PRIMARY
// conversion mechanism is lazy convert-on-load in app/collab/persistence.ts —
// this script exists to pre-convert cold documents (and JSON columns) so the
// long tail doesn't wait for its first post-migration open.
//
// Doc mode (default): iterate CollabDocument rows, and for each doc whose
// "blocknote" fragment is empty but whose legacy "default" fragment has
// content, run the same PM→blocks mapper the app uses and write the converted
// state back. Direct DB writes are safe here ONLY because each write is a CAS
// on updatedAt (skipped on conflict) and docs updated in the last 10 minutes
// are skipped entirely — anything live is owned by the in-app lazy path.
//
// Column mode (--columns): transcode legacy ProseMirror JSON columns to block
// JSON in place: ChallengeVersion.description, PageDoc.body + sections[].body,
// MentorNote.contentJson, MentorNoteTemplate.contentJson, question-array info
// bodies (data.body where type === "info") in ChallengeVersion /
// ShortformVersion / FormVersion, and SigningDocumentVersion.body.
// SigningSignature.frozenBody is NEVER transcoded — frozen snapshots are
// legal artifacts and the PDF pipeline reads them via ensureBlocks at export
// time.
//
// Usage (from dali-api/):
//   DATABASE_URL=... npx tsx scripts/convert-to-blocknote.ts [--dry-run] [--prefix doc:]
//   DATABASE_URL=... npx tsx scripts/convert-to-blocknote.ts --columns [--dry-run]

import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { prisma, type Prisma } from "../app/lib/db";
import {
  BLOCKNOTE_FRAGMENT,
  LEGACY_PM_FRAGMENT,
  blocksToFragment,
} from "../app/collab/blocknote-server";
import { mapPmDocToBlocks } from "../app/collab/legacy/pm-to-blocknote";

const DRY_RUN = process.argv.includes("--dry-run");
const COLUMNS_MODE = process.argv.includes("--columns");
const prefixIdx = process.argv.indexOf("--prefix");
const PREFIX = prefixIdx !== -1 ? process.argv[prefixIdx + 1] : undefined;

const RECENT_MS = 10 * 60 * 1000;
const BATCH = 200;

function logLosses(label: string, losses: string[]) {
  if (losses.length > 0) console.log(`  [loss] ${label}: ${losses.join("; ")}`);
}

// ---------------------------------------------------------------------------
// Doc sweep

async function sweepDocs() {
  const counts = {
    converted: 0,
    alreadyConverted: 0,
    empty: 0,
    recentlyActive: 0,
    conflict: 0,
    failed: 0,
  };

  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.collabDocument.findMany({
      where: PREFIX ? { name: { startsWith: PREFIX } } : undefined,
      orderBy: { name: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { name: cursor } } : {}),
      select: { name: true, state: true, updatedAt: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.name;

    for (const row of rows) {
      if (Date.now() - row.updatedAt.getTime() < RECENT_MS) {
        counts.recentlyActive++;
        console.log(`skip (active <10min): ${row.name}`);
        continue;
      }

      const ydoc = new Y.Doc();
      try {
        Y.applyUpdate(ydoc, new Uint8Array(row.state));
        if (ydoc.getXmlFragment(BLOCKNOTE_FRAGMENT).length > 0) {
          counts.alreadyConverted++;
          continue;
        }
        if (ydoc.getXmlFragment(LEGACY_PM_FRAGMENT).length === 0) {
          counts.empty++;
          continue;
        }

        const pmJson = yDocToProsemirrorJSON(ydoc, LEGACY_PM_FRAGMENT);
        const { blocks, losses } = mapPmDocToBlocks(pmJson);
        console.log(`convert: ${row.name} (${blocks.length} blocks)${DRY_RUN ? " [dry-run]" : ""}`);
        logLosses(row.name, losses);
        if (DRY_RUN) {
          counts.converted++;
          continue;
        }

        ydoc.transact(() => {
          blocksToFragment(blocks, ydoc.getXmlFragment(BLOCKNOTE_FRAGMENT));
        });
        const state = Y.encodeStateAsUpdate(ydoc) as Uint8Array<ArrayBuffer>;

        // CAS on updatedAt: if anything (an editor session, the lazy
        // converter) wrote since we read, drop our version — theirs is newer
        // and already converted or about to be.
        const res = await prisma.collabDocument.updateMany({
          where: { name: row.name, updatedAt: row.updatedAt },
          data: { state },
        });
        if (res.count === 0) {
          counts.conflict++;
          console.log(`  skipped write (concurrent update): ${row.name}`);
        } else {
          counts.converted++;
        }
      } catch (err) {
        counts.failed++;
        console.error(`  FAILED: ${row.name}`, err);
      } finally {
        ydoc.destroy();
      }
    }
  }

  console.log(
    `\ndocs done: converted=${counts.converted} alreadyConverted=${counts.alreadyConverted} ` +
      `empty=${counts.empty} recentlyActive=${counts.recentlyActive} conflict=${counts.conflict} failed=${counts.failed}`,
  );
}

// ---------------------------------------------------------------------------
// Column transcode

function isPmDoc(value: unknown): value is { type: "doc" } {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { type?: string }).type === "doc"
  );
}

// Transcode a single JSON value if (and only if) it's a legacy PM doc.
function transcode(label: string, value: unknown): Prisma.InputJsonValue | null {
  if (!isPmDoc(value)) return null;
  const { blocks, losses } = mapPmDocToBlocks(value);
  logLosses(label, losses);
  return blocks as unknown as Prisma.InputJsonValue;
}

// Transcode `data.body` on info questions inside a question array.
function transcodeQuestions(
  label: string,
  questions: unknown,
): { changed: boolean; next: Prisma.InputJsonValue } {
  if (!Array.isArray(questions)) {
    return { changed: false, next: questions as Prisma.InputJsonValue };
  }
  let changed = false;
  const next = questions.map((q, i) => {
    if (
      q != null &&
      typeof q === "object" &&
      (q as { type?: string }).type === "info"
    ) {
      const data = (q as { data?: { body?: unknown } }).data;
      const body = transcode(`${label}[${i}].data.body`, data?.body);
      if (body) {
        changed = true;
        return { ...(q as object), data: { ...(data as object), body } };
      }
    }
    return q;
  });
  return { changed, next: next as Prisma.InputJsonValue };
}

async function transcodeColumns() {
  let updates = 0;

  // ChallengeVersion: description + questions info bodies.
  for (const row of await prisma.challengeVersion.findMany({
    select: { id: true, description: true, questions: true },
  })) {
    const description = transcode(`ChallengeVersion(${row.id}).description`, row.description);
    const questions = transcodeQuestions(`ChallengeVersion(${row.id}).questions`, row.questions);
    if (!description && !questions.changed) continue;
    updates++;
    console.log(`ChallengeVersion ${row.id}${DRY_RUN ? " [dry-run]" : ""}`);
    if (DRY_RUN) continue;
    await prisma.challengeVersion.update({
      where: { id: row.id },
      data: {
        ...(description ? { description } : {}),
        ...(questions.changed ? { questions: questions.next } : {}),
      },
    });
  }

  // ShortformVersion + FormVersion: questions info bodies.
  for (const row of await prisma.shortformVersion.findMany({
    select: { id: true, questions: true },
  })) {
    const questions = transcodeQuestions(`ShortformVersion(${row.id}).questions`, row.questions);
    if (!questions.changed) continue;
    updates++;
    console.log(`ShortformVersion ${row.id}${DRY_RUN ? " [dry-run]" : ""}`);
    if (DRY_RUN) continue;
    await prisma.shortformVersion.update({
      where: { id: row.id },
      data: { questions: questions.next },
    });
  }
  for (const row of await prisma.formVersion.findMany({
    select: { id: true, questions: true },
  })) {
    const questions = transcodeQuestions(`FormVersion(${row.id}).questions`, row.questions);
    if (!questions.changed) continue;
    updates++;
    console.log(`FormVersion ${row.id}${DRY_RUN ? " [dry-run]" : ""}`);
    if (DRY_RUN) continue;
    await prisma.formVersion.update({
      where: { id: row.id },
      data: { questions: questions.next },
    });
  }

  // PageDoc: body + sections[].body.
  for (const row of await prisma.pageDoc.findMany({
    select: { id: true, pageKey: true, body: true, sections: true },
  })) {
    const body = transcode(`PageDoc(${row.pageKey}).body`, row.body);
    let sectionsChanged = false;
    let sections = row.sections;
    if (Array.isArray(row.sections)) {
      const next = row.sections.map((section, i) => {
        if (section == null || typeof section !== "object") return section;
        const sBody = transcode(`PageDoc(${row.pageKey}).sections[${i}].body`, (section as { body?: unknown }).body);
        if (!sBody) return section;
        sectionsChanged = true;
        return { ...(section as object), body: sBody };
      });
      if (sectionsChanged) sections = next as typeof row.sections;
    }
    if (!body && !sectionsChanged) continue;
    updates++;
    console.log(`PageDoc ${row.pageKey}${DRY_RUN ? " [dry-run]" : ""}`);
    if (DRY_RUN) continue;
    await prisma.pageDoc.update({
      where: { id: row.id },
      data: {
        ...(body ? { body } : {}),
        ...(sectionsChanged ? { sections: sections as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  }

  // Mentorship note bodies + templates.
  for (const row of await prisma.mentorNote.findMany({
    select: { id: true, contentJson: true },
  })) {
    const contentJson = transcode(`MentorNote(${row.id}).contentJson`, row.contentJson);
    if (!contentJson) continue;
    updates++;
    console.log(`MentorNote ${row.id}${DRY_RUN ? " [dry-run]" : ""}`);
    if (DRY_RUN) continue;
    await prisma.mentorNote.update({ where: { id: row.id }, data: { contentJson } });
  }
  for (const row of await prisma.mentorNoteTemplate.findMany({
    select: { id: true, contentJson: true },
  })) {
    const contentJson = transcode(`MentorNoteTemplate(${row.id}).contentJson`, row.contentJson);
    if (!contentJson) continue;
    updates++;
    console.log(`MentorNoteTemplate ${row.id}${DRY_RUN ? " [dry-run]" : ""}`);
    if (DRY_RUN) continue;
    await prisma.mentorNoteTemplate.update({ where: { id: row.id }, data: { contentJson } });
  }

  // Signing document version bodies. (SigningSignature.frozenBody is
  // deliberately absent — never transcode frozen snapshots.)
  for (const row of await prisma.signingDocumentVersion.findMany({
    select: { id: true, body: true },
  })) {
    const body = transcode(`SigningDocumentVersion(${row.id}).body`, row.body);
    if (!body) continue;
    updates++;
    console.log(`SigningDocumentVersion ${row.id}${DRY_RUN ? " [dry-run]" : ""}`);
    if (DRY_RUN) continue;
    await prisma.signingDocumentVersion.update({ where: { id: row.id }, data: { body } });
  }

  console.log(`\ncolumns done: ${updates} row(s) ${DRY_RUN ? "would be " : ""}updated`);
}

// ---------------------------------------------------------------------------

try {
  if (COLUMNS_MODE) await transcodeColumns();
  else await sweepDocs();
} finally {
  await prisma.$disconnect();
}
