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
 *   resources:lab:body                 the single lab-wide Resources document
 *   presence:{pageId}                  ephemeral, no persistence
 *   signing:{documentId}:draft         SigningDocument body — prose (BlockNote)
 *   form:{formId}:draft                Form question list — structured Y.Array
 *   rubric:{rubricId}:draft            Rubric criteria list — structured Y.Array
 */

export const PRESENCE_ROOM_PREFIX = "presence:";

/**
 * The lab-wide Resources document (route /resources). A fixed singleton room
 * rather than a Drive Page: there is exactly one of it, it is never renamed,
 * moved or archived, and its gate is a role (Core/Admin write, every lab member
 * reads) rather than a per-page share list.
 */
export const RESOURCES_ROOM = "resources:lab:body";

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

/** Collaborative canvas room for a Whiteboard Page (kind=Whiteboard). Stores a
 *  Y.Map of Excalidraw elements — structured, not a BlockNote fragment. Derived
 *  from the Page id (no contentDocId override). */
export function whiteboardRoomName(pageId: string): string {
  return `whiteboard:${pageId}:canvas`;
}
