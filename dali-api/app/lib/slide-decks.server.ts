import { prisma } from "~/lib/db.server";
import { getPageAccess, PAGE_ACCESS_SELECT } from "~/lib/pageAccess.server";
import { ensureLiveDeck } from "~/lib/live-deck.server";
import { readLiveDeck } from "~/collab/deck-live.server";
import type { DeckRead } from "~/collab/read-deck.server";

export type DeckResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

export interface DeckAccess {
  page: { id: string; title: string; iconEmoji: string | null };
  canEdit: boolean;
  canComment: boolean;
}

/** The deck page if the user may see it, or a failure for missing/non-deck/forbidden pages. */
export async function deckAccess(userId: string, pageId: string, request?: Request): Promise<DeckResult<DeckAccess>> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { ...PAGE_ACCESS_SELECT, title: true, kind: true, iconEmoji: true },
  });
  if (!page || page.archivedAt !== null || page.kind !== "Slides") return fail(404, "Slide deck not found.");
  const access = await getPageAccess(userId, page, request);
  if (!access.canView) return fail(404, "Slide deck not found.");
  return { ok: true, page: { id: page.id, title: page.title, iconEmoji: page.iconEmoji }, canEdit: access.canEdit, canComment: access.canComment };
}

/** The live deck. A page with no row or no room is made an empty live deck first, so every read finds one. */
export async function readDeckModel(pageId: string): Promise<DeckRead> {
  await ensureLiveDeck(pageId);
  return (await readLiveDeck(pageId)).read;
}
