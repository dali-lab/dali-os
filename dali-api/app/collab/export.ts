import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { prisma } from "~/lib/db";
import { renderNodes, type PMNode } from "./export-html";

// Server-side export pipeline for collab documents:
//   CollabDocument.state (Yjs binary) → Y.Doc → ProseMirror JSON → HTML.
// The HTML feeds both the PDF (pdfkit) and Word (html-to-docx) renderers, so
// the two formats stay visually consistent. Reads the persisted snapshot
// directly from Postgres — no live Hocuspocus connection needed.
//
// The pure ProseMirror→HTML rendering lives in export-html.ts (no DB import, so
// it's unit-testable); this module adds the DB-coupled decode steps. Both the
// type and the HTML builders are re-exported so existing importers (the export
// route) keep a single import surface.

export { renderNodes, buildExportHtml, type PMNode } from "./export-html";

const EMPTY_DOC: PMNode = { type: "doc", content: [] };

// Decode a CollabDocument's persisted Yjs state to ProseMirror JSON. Returns an
// empty doc when nothing is stored yet (never opened/edited). Both the HTML and
// PDF renderers consume this so the two formats stay in sync.
export async function collabDocToProseMirror(documentName: string): Promise<PMNode> {
  const row = await prisma.collabDocument.findUnique({
    where: { name: documentName },
    select: { state: true },
  });
  if (!row) return EMPTY_DOC;

  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, new Uint8Array(row.state));
    return yDocToProsemirrorJSON(ydoc, "default") as PMNode;
  } catch {
    return EMPTY_DOC;
  } finally {
    ydoc.destroy();
  }
}

// Decode a CollabDocument's persisted Yjs state to body HTML.
export async function collabDocToHtml(documentName: string): Promise<string> {
  const json = await collabDocToProseMirror(documentName);
  return renderNodes(json.content);
}
