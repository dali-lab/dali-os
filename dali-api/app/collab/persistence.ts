import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import type { Server as HocuspocusServer } from "@hocuspocus/server";
import { prisma } from "~/lib/db";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import { isPresenceRoom } from "./roomName";
import { isStructuredRoom, seedRegistryDoc, syncRegistryDocBack } from "./sources";
import {
  BLOCKNOTE_FRAGMENT,
  LEGACY_PM_FRAGMENT,
  blocksToFragment,
  plainTextToBlocks,
} from "./blocknote-server";
import { mapPmDocToBlocks } from "./legacy/pm-to-blocknote";
import { getStructuredData, ydocToBlocks } from "./read";

const SNAPSHOT_MIN_INTERVAL_MS = 30_000;

/**
 * parse a collab document name into its type and fields.
 * add more collaborative document types as needed.
 *
 * Naming convention:
 *   review:{reviewId}:feedback
 *   review:{reviewId}:rejectionRationale
 *   interview:{interviewId}:notes
 *   interview:{interviewId}:recommendation
 *   domainApplication:{domainApplicationId}:prepNote
 */
function parseDocName(name: string) {
  const parts = name.split(":");
  if (parts.length !== 3) return null;
  const [entity, id, field] = parts;
  return { entity, id, field };
}

/**
 * load initial content from the source DB field (used when a CollabDocument
 * doesn't exist yet — i.e. first collab session for this document).
 */
async function seedContent(name: string): Promise<string | null> {
  const parsed = parseDocName(name);
  if (!parsed) return null;

  const { entity, id, field } = parsed;

  if (entity === "review") {
    const review = await prisma.applicationReview.findUnique({ where: { id } });
    if (!review) return null;
    if (field === "feedback") return review.feedback;
    if (field === "rejectionRationale") return review.rejectionRationale;
  }

  if (entity === "domainApplication") {
    if (field === "prepNote") {
      const da = await prisma.domainApplication.findUnique({ where: { id } });
      if (!da) return null;
      return da.interviewPrepNote ?? "";
    }
  }

  if (entity === "task") {
    if (field === "description") {
      const task = await prisma.task.findUnique({ where: { id } });
      return task?.description ?? "";
    }
  }

  if (entity === "edusubmission") {
    if (field === "feedback") {
      const submission = await prisma.educationSubmission.findUnique({
        where: { id },
      });
      return submission?.feedbackText ?? "";
    }
  }

  if (entity === "interview") {
    const interview = await prisma.interview.findUnique({ where: { id } });
    if (!interview) return null;
    if (field === "recommendation") return interview.recommendationNotes ?? "";
    if (field === "notes") {
      // Joint notes — seed from the concatenation of existing per-interviewer notes
      const assignments = await prisma.interviewAssignment.findMany({
        where: { interviewId: id },
        include: {
          noteVersions: { orderBy: { createdAt: "desc" }, take: 1 },
          cycleInterviewer: { include: { user: true } },
        },
      });
      const parts: string[] = [];
      for (const a of assignments) {
        const latest = a.noteVersions[0];
        if (latest?.content) {
          const name =
            [
              a.cycleInterviewer.user.firstName,
              a.cycleInterviewer.user.lastName,
            ]
              .filter(Boolean)
              .join(" ") || "Interviewer";
          parts.push(`--- ${name} ---\n${latest.content}`);
        }
      }
      return parts.join("\n\n") || "";
    }
  }

  return null;
}

/**
 * LAZY CONVERSION — the in-app migration mechanism. If a loaded doc has legacy
 * Tiptap content in "default" but nothing in "blocknote" yet, map the PM JSON
 * to blocks and write them into the "blocknote" fragment the BlockNote editor
 * binds. The "default" fragment is left untouched (it simply goes stale) so
 * the conversion is one-way and re-runnable. Runs in-process on the
 * Hocuspocus-owned doc, so there is no cross-writer race.
 */
function convertLegacyFragment(name: string, doc: Y.Doc): boolean {
  const blocknote = doc.getXmlFragment(BLOCKNOTE_FRAGMENT);
  if (blocknote.length > 0) return false;
  if (doc.getXmlFragment(LEGACY_PM_FRAGMENT).length === 0) return false;

  try {
    const pmJson = yDocToProsemirrorJSON(doc, LEGACY_PM_FRAGMENT);
    const { blocks, losses } = mapPmDocToBlocks(pmJson);
    doc.transact(() => {
      blocksToFragment(blocks, blocknote);
    });
    console.log(
      `[collab:convert] converted ${name} to blocknote (${blocks.length} blocks)` +
        (losses.length > 0 ? ` — losses: ${losses.join("; ")}` : ""),
    );
    return true;
  } catch (err) {
    // A failed conversion must not block the load — the doc opens empty for
    // BlockNote clients and the legacy state stays intact for another attempt.
    console.error(`[collab:convert] conversion failed for ${name}`, err);
    return false;
  }
}

/**
 * Load a Y.Doc's state from the database. If no CollabDocument row exists,
 * seed the doc from the source field content. Stored legacy (Tiptap) docs are
 * converted to the "blocknote" fragment on load — see convertLegacyFragment.
 */
export async function loadDocument(name: string, doc: Y.Doc): Promise<void> {
  // Presence rooms are awareness-only; no doc content to load.
  if (isPresenceRoom(name)) return;

  const existing = await prisma.collabDocument.findUnique({ where: { name } });

  if (existing) {
    Y.applyUpdate(doc, new Uint8Array(existing.state));
    if (convertLegacyFragment(name, doc)) {
      // Persist the converted state right away so the conversion is durable
      // (a view-only session never fires onStoreDocument) and so a second
      // instance loading this doc sees a populated "blocknote" fragment
      // instead of running its own conversion.
      await storeDocument(name, doc);
    }
    return;
  }

  // Registry-backed rich surfaces (mentorship notes/templates, …) seed from
  // their source column (block JSON, or legacy ProseMirror JSON via the
  // mapper).
  const parsed = parseDocName(name);
  if (parsed && (await seedRegistryDoc(parsed.entity, parsed.id, doc))) return;

  // First time — seed one paragraph block per line of the legacy plain-text
  // source field.
  const content = await seedContent(name);
  if (content) {
    doc.transact(() => {
      blocksToFragment(plainTextToBlocks(content), doc.getXmlFragment(BLOCKNOTE_FRAGMENT));
    });
  }
}

/**
 * Strip inline-comment format attributes from every Y.XmlText node inside
 * `element`. The `comment` ProseMirror mark is stored by y-prosemirror as
 * attributes whose keys start with `"comment"` (e.g. `"comment--<hash>"`).
 * The server's BlockNote schema does not include the comment mark, so when
 * y-prosemirror tries to deserialise those attributes it throws and then
 * *deletes the Y.XmlText item* from the doc — corrupting the live document
 * and causing Hocuspocus to broadcast the deletion to clients.
 *
 * Call this on a **temporary clone** of the doc before reading plain text so
 * the deletion side-effect never touches the live document.
 */
function stripCommentFormats(element: Y.XmlFragment | Y.XmlElement): void {
  for (let i = 0; i < element.length; i++) {
    const child = element.get(i);
    if (child instanceof Y.XmlText) {
      const delta = child.toDelta() as Array<{
        insert?: string;
        attributes?: Record<string, unknown>;
      }>;
      let pos = 0;
      for (const op of delta) {
        const len = typeof op.insert === "string" ? op.insert.length : 1;
        if (op.attributes) {
          const commentKeys = Object.keys(op.attributes).filter((k) =>
            k.startsWith("comment"),
          );
          if (commentKeys.length > 0) {
            const nullAttrs: Record<string, null> = {};
            for (const k of commentKeys) nullAttrs[k] = null;
            child.format(pos, len, nullAttrs);
          }
        }
        pos += len;
      }
    } else if (child instanceof Y.XmlElement) {
      stripCommentFormats(child);
    }
  }
}

/**
 * Extract the plain text of a Y.Doc's body. Reads the "blocknote" fragment
 * (falling back to an in-memory conversion of legacy "default" content) and
 * flattens the blocks — one line per block, table cells joined by spaces.
 *
 * Works on a **temporary clone** of the doc so that the server-side BlockNote
 * schema (which does not include the `comment` mark) cannot trigger y-prosemirror's
 * destructive error-recovery path — which deletes Y.XmlText items from the live
 * document and causes Hocuspocus to broadcast that deletion to all clients.
 */
export function getPlainText(doc: Y.Doc): string {
  const clone = new Y.Doc();
  try {
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
    // Strip comment-format attributes before reading through the server schema.
    const fragment = clone.getXmlFragment(BLOCKNOTE_FRAGMENT);
    if (fragment.length > 0) {
      clone.transact(() => stripCommentFormats(fragment));
    }
    return blocksToPlainText(ydocToBlocks(clone).blocks);
  } finally {
    clone.destroy();
  }
}

export interface StoredDocState {
  state: Uint8Array<ArrayBuffer>;
  plainText: string;
}

/**
 * Serialize a structured (Y.Array / Y.Map) room to a compact JSON string for
 * the CollabDocumentVersion.plainText mirror. getPlainText() returns empty
 * string for these rooms (no BlockNote fragment), so structured rooms use this
 * instead. The result is a stable JSON encoding of the shared-type map so the
 * version preview still renders something human-readable.
 */
function getStructuredPlainText(doc: Y.Doc): string {
  try {
    return JSON.stringify(getStructuredData(doc));
  } catch {
    return "";
  }
}

/**
 * Store the Y.Doc binary state into CollabDocument, and sync the plain text
 * back to the source field so existing queries/views remain correct.
 * Returns the encoded state + plain text so callers (e.g. maybeSnapshot) can
 * reuse them without re-encoding.
 */
export async function storeDocument(
  name: string,
  doc: Y.Doc,
): Promise<StoredDocState | null> {
  if (isPresenceRoom(name)) return null;

  // Prisma v7 Bytes expects Uint8Array<ArrayBuffer> specifically
  const state = Y.encodeStateAsUpdate(doc) as Uint8Array<ArrayBuffer>;

  // Structured rooms (form:*, rubric:*) store Y.Array/Y.Map — getPlainText()
  // runs through the BlockNote fragment path and returns "" for them. Use the
  // JSON serialiser instead so the version snapshot plainText mirror is useful.
  const parsed = parseDocName(name);
  const structured = parsed ? isStructuredRoom(parsed.entity) : false;
  const plainText = structured ? getStructuredPlainText(doc) : getPlainText(doc);

  // Upsert the Y.Doc binary state
  await prisma.collabDocument.upsert({
    where: { name },
    create: { name, state },
    update: { state },
  });

  // Sync plain text back to source field
  if (!parsed) return { state, plainText };

  // Registry-backed surfaces sync full block JSON back to their source column;
  // skip the legacy plain-text sync below.
  if (await syncRegistryDocBack(parsed.entity, parsed.id, doc)) {
    return { state, plainText };
  }

  const { entity, id, field } = parsed;

  if (entity === "review") {
    if (field === "feedback") {
      await prisma.applicationReview.update({
        where: { id },
        data: { feedback: plainText },
      });
    } else if (field === "rejectionRationale") {
      await prisma.applicationReview.update({
        where: { id },
        data: { rejectionRationale: plainText },
      });
    }
  }

  if (entity === "domainApplication") {
    if (field === "prepNote") {
      await prisma.domainApplication.update({
        where: { id },
        data: { interviewPrepNote: plainText },
      });
    }
  }

  if (entity === "task") {
    if (field === "description") {
      await prisma.task.update({
        where: { id },
        data: { description: plainText },
      });
    }
  }

  if (entity === "epic") {
    if (field === "description") {
      // `id` here is the epic's descriptionDocId (the opaque room name), not
      // the epic id, and that column isn't unique — hence updateMany. Mirrors
      // the doc back to the plain-text column the timeline hover card and the
      // modal's pre-editor fallback read, so they don't go stale after edits.
      await prisma.epic.updateMany({
        where: { descriptionDocId: id },
        data: { description: plainText },
      });
    }
  }

  if (entity === "edusubmission") {
    if (field === "feedback") {
      await prisma.educationSubmission.update({
        where: { id },
        data: { feedbackText: plainText },
      });
    }
  }

  if (entity === "interview") {
    if (field === "recommendation") {
      await prisma.interview.update({
        where: { id },
        data: { recommendationNotes: plainText },
      });
    }
    // "notes" is the joint doc — no single source field to sync back to.
    // The InterviewNoteVersion table is append-only per-assignment; the
    // collaborative doc supersedes it. No sync-back needed.
  }

  return { state, plainText };
}

/**
 * Conditionally append a CollabDocumentVersion snapshot. No-op for presence
 * rooms, and throttled so consecutive `onStoreDocument` ticks (which fire
 * every 2s during active editing) don't all create rows. Called from
 * onStoreDocument and onDisconnect after the live state has been persisted.
 *
 * Idle docs produce no snapshots: Hocuspocus only fires onStoreDocument when
 * there are pending Y updates, so silence on the doc means silence here.
 */
export async function maybeSnapshot(
  name: string,
  stored: StoredDocState,
  authorIds: string[],
): Promise<boolean> {
  if (isPresenceRoom(name)) return false;

  // Cross-instance dedup. The Hocuspocus Redis extension already serializes
  // onStoreDocument across machines, but onDisconnect fires per-machine, so
  // simultaneous disconnects on different instances would race the throttle
  // window. A transaction-scoped Postgres advisory lock keyed on the doc name
  // pins the findFirst+create check to one instance at a time and auto-releases
  // when the transaction ends.
  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${name}))`;

    const latest = await tx.collabDocumentVersion.findFirst({
      where: { name },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < SNAPSHOT_MIN_INTERVAL_MS) {
      return false;
    }

    await tx.collabDocumentVersion.create({
      data: {
        name,
        state: stored.state,
        plainText: stored.plainText,
        authorIds,
      },
    });
    return true;
  });
}

/**
 * Replace the live Y.Doc content with the content of a previous snapshot.
 * Opens a server-side direct connection to the doc so the change is applied
 * inside Hocuspocus's normal sync pipeline — connected clients receive the
 * new state through the websocket and update without reconnecting.
 *
 * The snapshot is decoded to blocks (mapping legacy pre-migration snapshots
 * through the PM→blocks converter) and written into the "blocknote" fragment,
 * so version history spans the migration boundary.
 */
export async function restoreVersion(
  server: HocuspocusServer,
  name: string,
  versionId: string,
): Promise<void> {
  if (isPresenceRoom(name)) {
    throw new Error("Cannot restore a presence room");
  }

  const version = await prisma.collabDocumentVersion.findUnique({
    where: { id: versionId },
  });
  if (!version || version.name !== name) {
    throw new Error("Version not found for this document");
  }

  const tmp = new Y.Doc();
  let blocks;
  try {
    Y.applyUpdate(tmp, new Uint8Array(version.state));
    blocks = ydocToBlocks(tmp).blocks;
  } finally {
    tmp.destroy();
  }

  const conn = await server.hocuspocus.openDirectConnection(name);
  try {
    await conn.transact((doc) => {
      blocksToFragment(blocks, doc.getXmlFragment(BLOCKNOTE_FRAGMENT));
    });
  } finally {
    await conn.disconnect();
  }
}
