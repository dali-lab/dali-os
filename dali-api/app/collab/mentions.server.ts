import * as Y from "yjs";
import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { ydocToBlocks } from "./read";

// @-mention notifications for collaborative document *bodies*. Comment mentions
// go through api.comments; page-doc guide bodies through api.page-docs. This is
// the third surface: the Yjs-synced doc body itself, notified from the collab
// store hook (onStoreDocument in server.ts) since there's no POST to diff.
//
// Dedup is via CollabDocument.notifiedMentionUserIds: a mention notifies its
// target at most once per document, so the throttled/repeated store hook never
// spams. Re-mentioning someone already notified does nothing (by design).

// Only `doc:{pageId}:body` rooms map to a mentionable Page document today.
function parseDocRoom(documentName: string): string | null {
  const m = /^doc:([^:]+):body$/.exec(documentName);
  return m ? m[1]! : null;
}

// Collect the user ids of every `mention` inline node in the doc body. Reads
// the block JSON via ydocToBlocks on a *clone* of the doc — the server schema
// does not know the `comment` mark, so reading the live doc through y-prosemirror
// would delete Y.XmlText items that carry comment marks (a destructive side-effect
// inside y-prosemirror's error handler). Using a clone means any such deletion
// happens to a throwaway doc and never propagates to connected clients.
export function extractMentionUserIds(doc: Y.Doc): string[] {
  const ids = new Set<string>();
  type InlineNode = { type?: string; props?: Record<string, unknown>; content?: unknown };
  const walkInline = (node: unknown) => {
    if (node == null || typeof node !== "object") return;
    const inline = node as InlineNode;
    if (inline.type === "mention") {
      const id = inline.props?.id;
      if (typeof id === "string" && id) ids.add(id);
    }
    if (Array.isArray(inline.content)) inline.content.forEach(walkInline);
  };
  const walkBlock = (block: {
    content?: unknown;
    children?: unknown[];
  }) => {
    const content = block.content;
    if (Array.isArray(content)) {
      content.forEach(walkInline);
    } else if (content && typeof content === "object") {
      const rows = (content as { rows?: { cells?: unknown[] }[] }).rows ?? [];
      for (const row of rows) {
        for (const cell of row.cells ?? []) {
          if (Array.isArray(cell)) cell.forEach(walkInline);
          else if (cell && typeof cell === "object") {
            const cellContent = (cell as { content?: unknown[] }).content;
            if (Array.isArray(cellContent)) cellContent.forEach(walkInline);
          }
        }
      }
    }
    for (const child of block.children ?? []) walkBlock(child as typeof block);
  };
  const clone = new Y.Doc();
  try {
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
    for (const block of ydocToBlocks(clone).blocks) walkBlock(block);
  } finally {
    clone.destroy();
  }
  return [...ids];
}

/**
 * Notify newly @-mentioned users in a collab doc body. `authorIds` are the
 * users who edited since the last store — excluded so an editor tagging
 * themselves (or being the one who typed the mention) isn't notified.
 * Best-effort: never throws into the store hook.
 */
export async function notifyCollabDocMentions(
  documentName: string,
  doc: Y.Doc,
  authorIds: string[],
): Promise<void> {
  const pageId = parseDocRoom(documentName);
  if (!pageId) return;

  const mentioned = extractMentionUserIds(doc);
  if (mentioned.length === 0) return;

  const record = await prisma.collabDocument.findUnique({
    where: { name: documentName },
    select: { notifiedMentionUserIds: true },
  });
  const already = new Set(record?.notifiedMentionUserIds ?? []);
  const authors = new Set(authorIds);

  const fresh = mentioned.filter((id) => !already.has(id) && !authors.has(id));

  if (fresh.length > 0) {
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { title: true },
    });
    await notify({
      eventType: "pagedoc.mention",
      message: {
        // ?mention=1 tells the document page to scroll to (and flash) this
        // reader's own mention once the collab doc syncs.
        title: `You were mentioned in: ${page?.title ?? "a document"}`,
        body: "You were tagged in a document.",
        link: `/documents/${pageId}?mention=1`,
      },
      recipients: fresh.map((userId) => ({ userId })),
    });
  }

  // Mark every currently-mentioned id as "seen" — including author self-mentions
  // and any that were skipped — so none of them re-notify later for this doc.
  const union = [...new Set([...already, ...mentioned])];
  if (union.length !== already.size) {
    await prisma.collabDocument.update({
      where: { name: documentName },
      data: { notifiedMentionUserIds: union },
    });
  }
}
