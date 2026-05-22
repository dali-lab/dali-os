import * as Y from "yjs";
import type { Server as HocuspocusServer } from "@hocuspocus/server";
import { prisma } from "~/lib/db";
import { isPresenceRoom } from "./roomName";

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
 *   partner-note:{noteId}:body   (PartnerMeetingNote — seeded from template)
 */
function parseDocName(name: string) {
  // partner-note uses a hyphen so the entity segment is "partner-note", not "partner".
  // Split on the first two ":" only to avoid breaking the entity name.
  const idx1 = name.indexOf(":");
  const idx2 = name.indexOf(":", idx1 + 1);
  if (idx1 === -1 || idx2 === -1) return null;
  const entity = name.slice(0, idx1);
  const id = name.slice(idx1 + 1, idx2);
  const field = name.slice(idx2 + 1);
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

  // Partner meeting note — seed with the standard meeting note template.
  if (entity === "partner-note" && field === "body") {
    return [
      "attendees",
      "- Alejandro",
      "- ",
      "",
      "agenda",
      "- intros",
      "- summary of project",
      "- review and questions",
      "",
      "things to go over",
      "- ",
      "",
      "notes",
      "",
      "questions",
      "- ",
      "",
      "moving forward steps",
      "- ",
      "",
      "evaluation",
      "RATE 1-5",
      "1- very poor | 2- poor | 3- acceptable | 4- good | 5- very good",
      "",
      "Partner Passion | ",
      "Partner would work well w/ students | ",
      "Unique niche | ",
      "Solving problem well | ",
      "Impact focused | ",
      "Interesting design / technical problems | ",
      "Aligns with members interest | ",
      "Students will feel impact | ",
      "Can pay | ",
    ].join("\n");
  }

  return null;
}

/**
 * Load a Y.Doc's state from the database. If no CollabDocument row exists,
 * seed the doc from the source field content.
 */
export async function loadDocument(name: string, doc: Y.Doc): Promise<void> {
  // Presence rooms are awareness-only; no doc content to load.
  if (isPresenceRoom(name)) return;

  const existing = await prisma.collabDocument.findUnique({ where: { name } });

  if (existing) {
    Y.applyUpdate(doc, new Uint8Array(existing.state));
    return;
  }

  // First time — seed from existing content into the XmlFragment that
  // y-prosemirror / Tiptap binds to. A minimal ProseMirror doc is a single
  // <paragraph> element wrapping a text node. Note: Y.XmlText() constructor
  // does NOT accept initial content — text must be inserted via .insert().
  const content = await seedContent(name);
  if (content) {
    const fragment = doc.getXmlFragment("default");
    for (const line of content.split("\n")) {
      const p = new Y.XmlElement("paragraph");
      if (line.length > 0) {
        const t = new Y.XmlText();
        t.insert(0, line);
        p.insert(0, [t]);
      }
      fragment.push([p]);
    }
  }
}

/**
 * Extract the plain text from a Y.Doc's "default" XmlFragment.
 * Walks the ProseMirror-style XML tree and joins paragraph content with newlines.
 */
export function getPlainText(doc: Y.Doc): string {
  const fragment = doc.getXmlFragment("default");
  const lines: string[] = [];
  for (let i = 0; i < fragment.length; i++) {
    const node = fragment.get(i);
    lines.push(node.toString());
  }
  // XmlElement.toString() wraps in tags like <paragraph>text</paragraph>,
  // so strip them to get plain text. Loop until stable to handle malformed
  // nested fragments like `<scr<script>ipt>`.
  return lines
    .map((l) => {
      let prev: string;
      let cur = l;
      do {
        prev = cur;
        cur = prev.replace(/<[^>]+>/g, "");
      } while (cur !== prev);
      return cur;
    })
    .join("\n");
}

export interface StoredDocState {
  state: Uint8Array<ArrayBuffer>;
  plainText: string;
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
  const plainText = getPlainText(doc);

  // Upsert the Y.Doc binary state
  await prisma.collabDocument.upsert({
    where: { name },
    create: { name, state },
    update: { state },
  });

  // Sync plain text back to source field
  const parsed = parseDocName(name);
  if (!parsed) return { state, plainText };

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
 * Marks/attributes survive because we deep-clone XmlElement children rather
 * than reseeding from plain text.
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
  Y.applyUpdate(tmp, new Uint8Array(version.state));
  const sourceFragment = tmp.getXmlFragment("default");

  const conn = await server.hocuspocus.openDirectConnection(name);
  try {
    await conn.transact((doc) => {
      const liveFragment = doc.getXmlFragment("default");
      liveFragment.delete(0, liveFragment.length);
      const cloned: Y.XmlElement[] = [];
      for (let i = 0; i < sourceFragment.length; i++) {
        const node = sourceFragment.get(i);
        if (node instanceof Y.XmlElement) cloned.push(node.clone());
      }
      if (cloned.length > 0) liveFragment.push(cloned);
    });
  } finally {
    await conn.disconnect();
  }
}
