// THE server read primitive for collaborative documents. Every server-side
// consumer of a doc body (exports, MCP read_page, public API, plaintext
// mirrors) reads blocks through here so the lazy-conversion story stays in one
// place:
//
//   - "blocknote" fragment non-empty → the document has been (or was born)
//     BlockNote — read it directly.
//   - else "default" fragment non-empty → legacy Tiptap document that hasn't
//     been opened since the migration — decode the PM XML and map it to blocks
//     IN MEMORY (no write; the durable conversion happens on editor load, see
//     persistence.loadDocument, or via scripts/convert-to-blocknote.ts).
//   - else → empty document.

import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { prisma } from "~/lib/db";
import {
  BLOCKNOTE_FRAGMENT,
  LEGACY_PM_FRAGMENT,
  fragmentToBlocks,
  type DocBlock,
} from "./blocknote-server";
import { mapPmDocToBlocks } from "./legacy/pm-to-blocknote";

export type DocBlockSource = "blocknote" | "legacy" | "empty";

export interface YDocBlocks {
  blocks: DocBlock[];
  source: DocBlockSource;
  losses: string[];
}

/** Read an in-memory Y.Doc as blocks, preferring the BlockNote fragment and
 * falling back to a legacy-PM in-memory conversion. Never mutates the doc. */
export function ydocToBlocks(doc: Y.Doc): YDocBlocks {
  const blocknote = doc.getXmlFragment(BLOCKNOTE_FRAGMENT);
  if (blocknote.length > 0) {
    return { blocks: fragmentToBlocks(blocknote), source: "blocknote", losses: [] };
  }
  const legacy = doc.getXmlFragment(LEGACY_PM_FRAGMENT);
  if (legacy.length > 0) {
    const pmJson = yDocToProsemirrorJSON(doc, LEGACY_PM_FRAGMENT);
    const { blocks, losses } = mapPmDocToBlocks(pmJson);
    return { blocks, source: "legacy", losses };
  }
  return { blocks: [], source: "empty", losses: [] };
}

/** Decode a persisted CollabDocument state into blocks. */
export function stateToBlocks(state: Uint8Array): YDocBlocks {
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, state);
    return ydocToBlocks(ydoc);
  } catch {
    return { blocks: [], source: "empty", losses: ["stored state failed to decode"] };
  } finally {
    ydoc.destroy();
  }
}

/** Load a collab document by room name and return its body as blocks. Missing
 * rows (doc never opened/edited) read as an empty document. Legacy-mapped
 * conversion losses are logged, not surfaced — reads must not fail. */
export async function readDocAsBlocks(documentName: string): Promise<DocBlock[]> {
  const row = await prisma.collabDocument.findUnique({
    where: { name: documentName },
    select: { state: true },
  });
  if (!row) return [];
  const { blocks, source, losses } = stateToBlocks(new Uint8Array(row.state));
  if (source === "legacy" && losses.length > 0) {
    console.warn(
      `[collab:convert] in-memory legacy read of ${documentName} lost: ${losses.join("; ")}`,
    );
  }
  return blocks;
}
