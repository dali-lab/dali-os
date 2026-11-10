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
import { prisma } from "~/lib/db.server";
import { getCollabServer } from "./server";
import { formDraftName } from "./roomName";
import { agentAnnouncer, bodyTexts, changedTextRange } from "./agent-presence.server";
import { loadDocument, maybeSnapshot, storeDocument } from "./persistence";
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
  const announcer = agentAnnouncer();
  await transactCollabDoc(
    name,
    authorId,
    (live) => {
      const before = bodyTexts(live).map((t) => t.toString());
      blocksToFragment(blocks, live.getXmlFragment(BLOCKNOTE_FRAGMENT));
      return changedTextRange(before, live);
    },
    {
      afterLiveChange: (range) =>
        void announcer.then((announce) => announce({ action: "editing", docRoom: name, range })),
    },
  );
}

export async function loadPersistedDoc(name: string, doc: Y.Doc): Promise<void> {
  const row = await prisma.collabDocument.findUnique({
    where: { name },
    select: { state: true },
  });
  if (row) Y.applyUpdate(doc, new Uint8Array(row.state));
  else await loadDocument(name, doc);
}

export async function transactCollabDoc<T>(
  name: string,
  authorId: string,
  mutate: (doc: Y.Doc) => T,
  options: {
    afterLiveChange?: (result: T) => void;
    prepare?: (doc: Y.Doc) => Promise<void>;
  } = {},
): Promise<T> {
  const server = getCollabServer();
  if (server) {
    const conn = await server.hocuspocus.openDirectConnection(name, { authorId });
    try {
      if (options.prepare && conn.document) await options.prepare(conn.document);
      let outcome: { value: T } | undefined;
      const stored = conn.transact((live) => {
        outcome = { value: mutate(live) };
      });
      const applied = outcome as { value: T } | undefined;
      if (applied) options.afterLiveChange?.(applied.value);
      await stored;
      return applied!.value;
    } finally {
      await conn.disconnect();
    }
  }

  const live = new Y.Doc();
  try {
    await loadPersistedDoc(name, live);
    await options.prepare?.(live);
    let result!: T;
    live.transact(() => {
      result = mutate(live);
    });
    const stored = await storeDocument(name, live);
    if (stored) await maybeSnapshot(name, stored, [authorId]);
    return result;
  } finally {
    live.destroy();
  }
}

export async function clearFormDraftRoom(formId: string): Promise<void> {
  const name = formDraftName(formId);
  const server = getCollabServer();
  if (server) {
    const conn = await server.hocuspocus.openDirectConnection(name);
    try {
      await conn.transact((live) => {
        const items = live.getArray("items");
        items.delete(0, items.length);
      });
    } finally {
      await conn.disconnect();
    }
    return;
  }
  await prisma.collabDocument.deleteMany({ where: { name } });
}
