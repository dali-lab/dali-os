import * as Y from "yjs";
import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";

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

// Walk the Y.XmlFragment for `mention` elements and collect their user ids.
// y-prosemirror serializes the ProseMirror mention node's `id` attr onto the
// Y.XmlElement, so getAttribute("id") is the tagged user id.
export function extractMentionUserIds(doc: Y.Doc): string[] {
  const fragment = doc.getXmlFragment("default");
  const ids = new Set<string>();
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook) => {
    if (node instanceof Y.XmlElement) {
      if (node.nodeName === "mention") {
        const id = node.getAttribute("id");
        if (typeof id === "string" && id) ids.add(id);
      }
      for (let i = 0; i < node.length; i++) walk(node.get(i));
    }
  };
  for (let i = 0; i < fragment.length; i++) walk(fragment.get(i));
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
