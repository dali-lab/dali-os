// Drive slide decks (Page.kind = Slides). The page carries title, placement
// and access; the slides live on the 1:1 SlideDeck row. Every write is a
// compare-and-set on SlideDeck.updatedAt, from the editor and MCP alike.

import { prisma, Prisma } from "~/lib/db.server";
import { getPageAccess, PAGE_ACCESS_SELECT } from "~/lib/pageAccess.server";
import { parseSlides } from "~/components/slides/slide-schema";
import type { Slide } from "~/components/slides/types";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { convertDeckToYjs } from "~/collab/deck-convert.server";
import { readLiveDeck } from "~/collab/deck-live.server";
import { projectLegacySlides } from "~/collab/read-deck.server";

export type DeckResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };

export const DECK_CONFLICT = "Someone else changed this deck. Reload to get their changes.";

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const version = (d: Date) => d.toISOString();
// Through JSON so optional fields left undefined drop out; Prisma rejects undefined inside Json.
const asJson = (slides: Slide[]) => JSON.parse(JSON.stringify(slides)) as Prisma.InputJsonValue;

export interface DeckAccess {
  page: { id: string; title: string; iconEmoji: string | null };
  canEdit: boolean;
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
  return { ok: true, page: { id: page.id, title: page.title, iconEmoji: page.iconEmoji }, canEdit: access.canEdit };
}

/** The deck's slides and save version. The row is created on first read, so a page made by any path opens. */
export async function loadDeck(pageId: string): Promise<{ slides: Slide[]; version: string; storage: "json" | "yjs" }> {
  const row = await prisma.slideDeck.upsert({
    where: { pageId },
    create: { pageId },
    update: {},
    select: { slides: true, updatedAt: true, storage: true },
  });
  if (row.storage === "yjs") {
    const live = await readLiveDeck(pageId);
    return {
      slides: projectLegacySlides(live.read),
      version: version(live.updatedAt ?? row.updatedAt),
      storage: "yjs",
    };
  }
  return { slides: parseSlides(row.slides) ?? [], version: version(row.updatedAt), storage: "json" };
}

export async function deckStorage(pageId: string): Promise<"json" | "yjs"> {
  const row = await prisma.slideDeck.findUnique({ where: { pageId }, select: { storage: true } });
  return row?.storage === "yjs" ? "yjs" : "json";
}

/**
 * Moves a JSON deck to live storage when `slides-collab` is on for this user. The flag only decides whether
 * to move; a deck already moved stays live whatever the flag says. Returns the storage the deck now uses.
 */
export async function migrateDeckOnOpen(userId: string, pageId: string, request?: Request): Promise<"json" | "yjs"> {
  if ((await deckStorage(pageId)) === "yjs") return "yjs";
  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("slides-collab", userId, roles, request))) return "json";
  await convertDeckToYjs(pageId);
  return "yjs";
}

async function writeIfUnchanged(
  userId: string,
  pageId: string,
  slides: Slide[],
  baseVersion: string,
): Promise<DeckResult<{ version: string }>> {
  const base = new Date(baseVersion);
  if (Number.isNaN(base.getTime())) return fail(400, "Missing version.");
  const { count } = await prisma.slideDeck.updateMany({
    where: { pageId, updatedAt: base, storage: "json" },
    data: { slides: asJson(slides), lastEditedById: userId },
  });
  if (count === 0) return fail(409, DECK_CONFLICT);
  const [saved] = await Promise.all([
    prisma.slideDeck.findUniqueOrThrow({ where: { pageId }, select: { updatedAt: true } }),
    prisma.page.update({ where: { id: pageId }, data: { lastEditedById: userId } }),
  ]);
  return { ok: true, version: version(saved.updatedAt) };
}

/** Saves `slides` only if nobody saved since `baseVersion`. */
export async function saveDeck(
  userId: string,
  pageId: string,
  slides: Slide[],
  baseVersion: string,
  request?: Request,
): Promise<DeckResult<{ version: string }>> {
  const access = await deckAccess(userId, pageId, request);
  if (!access.ok) return access;
  if (!access.canEdit) return fail(403, "You can view this deck but not edit it.");
  return writeIfUnchanged(userId, pageId, slides, baseVersion);
}

/**
 * Reads the deck, applies `edit`, and saves it. Retries once when a save lands
 * in between, so a scripted edit never clobbers someone else's.
 */
export async function editDeck(
  userId: string,
  pageId: string,
  edit: (slides: Slide[]) => Slide[] | Promise<Slide[]>,
  request?: Request,
): Promise<DeckResult<{ slides: Slide[]; version: string }>> {
  const access = await deckAccess(userId, pageId, request);
  if (!access.ok) return access;
  if (!access.canEdit) return fail(403, "You can view this deck but not edit it.");
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await loadDeck(pageId);
    const slides = await edit(current.slides);
    if (!parseSlides(asJson(slides))) return fail(400, "That isn't a valid deck.");
    const saved = await writeIfUnchanged(userId, pageId, slides, current.version);
    if (saved.ok) return { ok: true, slides, version: saved.version };
    if (saved.status !== 409) return saved;
  }
  return fail(409, DECK_CONFLICT);
}
