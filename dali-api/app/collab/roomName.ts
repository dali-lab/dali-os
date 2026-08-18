/**
 * Naming for collaborative rooms. Used by both the client (PresenceProvider,
 * DocEditor collab wiring) and the server (persistence) so the prefix and
 * shape stay in sync.
 *
 * Naming conventions:
 *   review:{reviewId}:feedback
 *   review:{reviewId}:rejectionRationale
 *   interview:{interviewId}:notes
 *   interview:{interviewId}:recommendation
 *   doc:{pageId}:body                  FreeForm Page bodies (DocumentEditor)
 *   presence:{pageId}                  ephemeral, no persistence
 *   signing:{documentId}:draft         SigningDocument body — prose (BlockNote)
 *   form:{formId}:draft                Form question list — structured Y.Array
 *   rubric:{rubricId}:draft            Rubric criteria list — structured Y.Array
 */

export const PRESENCE_ROOM_PREFIX = "presence:";

// The collab room backing a FreeForm Page's rich-text body. Seeded pages can
// override via Page.contentDocId; everything created in-app uses this shape.
export function pageDocName(pageId: string): string {
  return `doc:${pageId}:body`;
}

export function presenceRoomName(pageId: string): string {
  return `${PRESENCE_ROOM_PREFIX}${pageId}`;
}

export function isPresenceRoom(name: string): boolean {
  return name.startsWith(PRESENCE_ROOM_PREFIX);
}

// ─── Drive editor draft rooms ────────────────────────────────────────────────

/** Prose draft room for a SigningDocument body. Rendered by DocEditor with the
 *  "agreement" feature preset. */
export function signingDraftName(documentId: string): string {
  return `signing:${documentId}:draft`;
}

/** Structured draft room for a Form's working question list (Y.Array). */
export function formDraftName(formId: string): string {
  return `form:${formId}:draft`;
}

/** Structured draft room for a Rubric's criteria list (Y.Array). */
export function rubricDraftName(rubricId: string): string {
  return `rubric:${rubricId}:draft`;
}
