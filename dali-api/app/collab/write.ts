// Server-side write pipeline for collab documents — the reverse of export.ts:
//   ProseMirror JSON → Y.Doc → live Hocuspocus doc (or persisted state).
//
// Writing goes through the running Hocuspocus server when one exists (same
// direct-connection pattern as restoreVersion in persistence.ts) so connected
// editors receive the new body over their websocket and the normal
// onStoreDocument persistence/snapshot hooks fire. When no collab server is
// running in this process (tests, one-off scripts), it falls back to mutating
// the persisted CollabDocument state directly. The pure PM-JSON → Yjs steps
// live in pm-to-y.ts.

import * as Y from "yjs";
import { prisma } from "~/lib/db";
import { getCollabServer } from "./server";
import { maybeSnapshot, storeDocument } from "./persistence";
import { pmJsonToYDoc, replaceFragment } from "./pm-to-y";
import type { PMNode } from "./export-html";

export async function replaceCollabDocContent(
  name: string,
  doc: PMNode,
  authorId: string,
): Promise<void> {
  const source = pmJsonToYDoc(doc);
  const sourceFragment = source.getXmlFragment("default");

  try {
    const server = getCollabServer();
    if (server) {
      const conn = await server.hocuspocus.openDirectConnection(name);
      try {
        await conn.transact((live) => {
          replaceFragment(live.getXmlFragment("default"), sourceFragment);
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
      replaceFragment(live.getXmlFragment("default"), sourceFragment);
      const stored = await storeDocument(name, live);
      if (stored) await maybeSnapshot(name, stored, [authorId]);
    } finally {
      live.destroy();
    }
  } finally {
    source.destroy();
  }
}
