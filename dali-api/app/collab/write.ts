// Server-side write pipeline for collab documents — the reverse of read.ts:
//   blocks → "blocknote" fragment of the live Hocuspocus doc (or persisted
//   state).
//
// Writing goes through the running Hocuspocus server when one exists (same
// direct-connection pattern as restoreVersion in persistence.ts) so connected
// editors receive the new body over their websocket and the normal
// onStoreDocument persistence/snapshot hooks fire. When no collab server is
// running in this process (tests, one-off scripts), it falls back to mutating
// the persisted CollabDocument state directly.
//
// The "default" (legacy ProseMirror) fragment is never touched: a write to
// "blocknote" marks the doc converted, and readers prefer that fragment from
// then on.

import * as Y from "yjs";
import { prisma } from "~/lib/db";
import { getCollabServer } from "./server";
import { maybeSnapshot, storeDocument } from "./persistence";
import {
  BLOCKNOTE_FRAGMENT,
  blocksToFragment,
  type DocBlock,
} from "./blocknote-server";
import { ensureBlocks } from "./legacy/pm-to-blocknote";
import type { PMNode } from "./export-html";

/**
 * Replace a collab document's body. `content` is block JSON; legacy
 * ProseMirror JSON (`{type:"doc"}`) is accepted for compatibility and mapped
 * through ensureBlocks.
 */
export async function replaceCollabDocContent(
  name: string,
  content: DocBlock[] | PMNode,
  authorId: string,
): Promise<void> {
  const blocks = ensureBlocks(content);

  const server = getCollabServer();
  if (server) {
    const conn = await server.hocuspocus.openDirectConnection(name);
    try {
      await conn.transact((live) => {
        blocksToFragment(blocks, live.getXmlFragment(BLOCKNOTE_FRAGMENT));
      });
    } finally {
      await conn.disconnect();
    }
    return;
  }

  const live = new Y.Doc();
  try {
    const row = await prisma.collabDocument.findUnique({
      where: { name },
      select: { state: true },
    });
    if (row) Y.applyUpdate(live, new Uint8Array(row.state));
    live.transact(() => {
      blocksToFragment(blocks, live.getXmlFragment(BLOCKNOTE_FRAGMENT));
    });
    const stored = await storeDocument(name, live);
    if (stored) await maybeSnapshot(name, stored, [authorId]);
  } finally {
    live.destroy();
  }
}
