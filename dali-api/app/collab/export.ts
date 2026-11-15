import { blocksToHtml } from "./blocknote-server";
import { readDocAsBlocks } from "./read";

// Server-side export pipeline for collab documents:
//   CollabDocument.state (Yjs binary) → blocks (readDocAsBlocks) → HTML/etc.
// Reads the persisted snapshot directly from Postgres — no live Hocuspocus
// connection needed.

export { renderNodes, buildExportHtml, type PMNode } from "./export-html";
export { readDocAsBlocks } from "./read";

// Decode a CollabDocument's persisted state to body HTML (semantic, print/
// docx-friendly — see blocksToHtml).
export async function collabDocToHtml(documentName: string): Promise<string> {
  const blocks = await readDocAsBlocks(documentName);
  return blocksToHtml(blocks);
}
