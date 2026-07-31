import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { prisma } from "~/lib/db";
import type { PMNode } from "./export-html";
import { BLOCKNOTE_FRAGMENT, LEGACY_PM_FRAGMENT, blocksToHtml, fragmentToBlocks } from "./blocknote-server";
import { blocksToPmDoc } from "./legacy/blocknote-to-pm";
import { readDocAsBlocks } from "./read";

// Server-side export pipeline for collab documents:
//   CollabDocument.state (Yjs binary) → blocks (readDocAsBlocks) → HTML/etc.
// Reads the persisted snapshot directly from Postgres — no live Hocuspocus
// connection needed.
//
// `collabDocToProseMirror` survives as a compatibility read for routes that
// still render legacy ProseMirror JSON: converted docs are mapped blocks→PM so
// those surfaces keep showing CURRENT content (the "default" fragment goes
// stale the moment a doc converts).

export { renderNodes, buildExportHtml, type PMNode } from "./export-html";
export { readDocAsBlocks } from "./read";

const EMPTY_DOC: PMNode = { type: "doc", content: [] };

// Decode a CollabDocument's persisted state to LEGACY ProseMirror JSON.
// Returns an empty doc when nothing is stored yet (never opened/edited).
export async function collabDocToProseMirror(documentName: string): Promise<PMNode> {
  const row = await prisma.collabDocument.findUnique({
    where: { name: documentName },
    select: { state: true },
  });
  if (!row) return EMPTY_DOC;

  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, new Uint8Array(row.state));
    const blocknote = ydoc.getXmlFragment(BLOCKNOTE_FRAGMENT);
    if (blocknote.length > 0) {
      return blocksToPmDoc(fragmentToBlocks(blocknote));
    }
    if (ydoc.getXmlFragment(LEGACY_PM_FRAGMENT).length === 0) return EMPTY_DOC;
    return yDocToProsemirrorJSON(ydoc, LEGACY_PM_FRAGMENT) as PMNode;
  } catch {
    return EMPTY_DOC;
  } finally {
    ydoc.destroy();
  }
}

// Decode a CollabDocument's persisted state to body HTML (semantic, print/
// docx-friendly — see blocksToHtml).
export async function collabDocToHtml(documentName: string): Promise<string> {
  const blocks = await readDocAsBlocks(documentName);
  return blocksToHtml(blocks);
}
