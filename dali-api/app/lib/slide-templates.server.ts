import { z } from "zod";
import * as Y from "yjs";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { canListWorkspace } from "~/drive/lib/page-templates.server";
import { deckAccess, deckStorage, migrateDeckOnOpen, readDeckModel } from "~/lib/slide-decks.server";
import { transactDeck } from "~/collab/deck-live.server";
import type { DeckRead } from "~/collab/read-deck.server";
import { sanitizeClips, pasteSlides, type SlideClip } from "~/components/slides/deck/slide-clipboard";
import { setThemeId } from "~/components/slides/deck/deck-ops";
import { isDeleted, slidesMap, tombstoneSlide } from "~/components/slides/deck/model";
import { THEMES } from "~/components/slides/deck/themes";
import type { SlideTemplateKind, WorkspaceType } from "~/generated/prisma/client";

export const MAX_TEMPLATES_PER_SCOPE = 200;
const MAX_PAYLOAD_BYTES = 2_000_000;

export const createTemplateSchema = z.object({
  kind: z.enum(["Deck", "Slide"]),
  title: z.string().trim().min(1).max(120),
  pageId: z.string().min(1),
  scope: z.enum(["lab", "project"]),
  themeId: z.string().min(1).max(60),
  slides: z.array(z.unknown()).min(1).max(50),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export interface SlideTemplateRow {
  id: string;
  kind: SlideTemplateKind;
  title: string;
  themeId: string;
  slideCount: number;
  scope: "lab" | "project";
  firstLayoutId: string | null;
  canDelete: boolean;
}

export type TemplateResult<T extends object = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

async function pageScope(pageId: string) {
  return prisma.page.findUnique({ where: { id: pageId }, select: { workspaceType: true, workspaceId: true } });
}

const firstLayout = (payload: unknown): string | null => {
  const clips = sanitizeClips(payload);
  return clips?.[0]?.layoutId ?? null;
};

/** Lab templates, plus the deck's project's when it is in one. Empty when the viewer cannot see the deck. */
export async function listSlideTemplates(
  userId: string,
  pageId: string,
  request?: Request,
): Promise<TemplateResult<{ templates: SlideTemplateRow[]; canSaveToProject: boolean }>> {
  const access = await deckAccess(userId, pageId, request);
  if (!access.ok) return access;
  const page = await pageScope(pageId);
  const projectId = page?.workspaceType === "Project" ? page.workspaceId : null;
  const result = await listForScopes(userId, projectId);
  return { ok: true, ...result, canSaveToProject: projectId !== null && (await canListWorkspace(userId, "Project", projectId)) };
}

/** Templates the viewer can use from a Drive scope: the lab's, plus one project's when given. */
export async function listForScopes(userId: string, projectId: string | null) {
  const [lab, project] = await Promise.all([
    canListWorkspace(userId, "Lab", null),
    projectId ? canListWorkspace(userId, "Project", projectId) : Promise.resolve(false),
  ]);
  const or: Array<{ workspaceType: WorkspaceType; workspaceId: string | null }> = [];
  if (lab) or.push({ workspaceType: "Lab", workspaceId: null });
  if (project && projectId) or.push({ workspaceType: "Project", workspaceId: projectId });
  if (or.length === 0) return { templates: [] as SlideTemplateRow[] };
  const [rows, core] = await Promise.all([
    prisma.slideTemplate.findMany({ where: { OR: or }, orderBy: { title: "asc" } }),
    isCore(userId),
  ]);
  return {
    templates: rows.map(
      (r): SlideTemplateRow => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        themeId: r.themeId,
        slideCount: r.slideCount,
        scope: r.workspaceType === "Project" ? "project" : "lab",
        firstLayoutId: firstLayout(r.payload),
        canDelete: core || r.createdById === userId,
      }),
    ),
  };
}

async function readableTemplate(userId: string, id: string) {
  const row = await prisma.slideTemplate.findUnique({ where: { id } });
  if (!row) return null;
  return (await canListWorkspace(userId, row.workspaceType, row.workspaceId)) ? row : null;
}

export async function getSlideTemplate(userId: string, id: string): Promise<TemplateResult<{ template: SlideTemplateRow & { slides: SlideClip[] } }>> {
  const row = await readableTemplate(userId, id);
  const slides = row ? sanitizeClips(row.payload) : null;
  if (!row || !slides) return fail(404, "Template not found.");
  const core = await isCore(userId);
  return {
    ok: true,
    template: {
      id: row.id,
      kind: row.kind,
      title: row.title,
      themeId: row.themeId,
      slideCount: row.slideCount,
      scope: row.workspaceType === "Project" ? "project" : "lab",
      firstLayoutId: slides[0]?.layoutId ?? null,
      canDelete: core || row.createdById === userId,
      slides,
    },
  };
}

export async function createSlideTemplate(userId: string, input: CreateTemplateInput, request?: Request): Promise<TemplateResult<{ id: string }>> {
  const access = await deckAccess(userId, input.pageId, request);
  if (!access.ok) return access;
  if (!access.canEdit) return fail(403, "You can view this deck but not save it as a template.");
  if (!THEMES.some((t) => t.id === input.themeId)) return fail(400, "Unknown theme.");
  const page = await pageScope(input.pageId);
  let workspaceType: WorkspaceType = "Lab";
  let workspaceId: string | null = null;
  if (input.scope === "project") {
    if (page?.workspaceType !== "Project" || !page.workspaceId) return fail(400, "This deck isn't in a project.");
    workspaceType = "Project";
    workspaceId = page.workspaceId;
  }
  if (!(await canListWorkspace(userId, workspaceType, workspaceId))) return fail(403, "You can't save templates here.");
  const slides = sanitizeClips(input.slides);
  if (!slides) return fail(400, "There is nothing to save.");
  if (input.kind === "Deck" && slides.length !== input.slides.length) return fail(400, "Some slides couldn't be saved.");
  if (JSON.stringify(slides).length > MAX_PAYLOAD_BYTES) return fail(413, "That's too large to save as a template.");
  const existing = await prisma.slideTemplate.count({ where: { workspaceType, workspaceId } });
  if (existing >= MAX_TEMPLATES_PER_SCOPE) return fail(409, "There are too many templates here. Delete some first.");
  const row = await prisma.slideTemplate.create({
    data: {
      kind: input.kind,
      workspaceType,
      workspaceId,
      title: input.title,
      themeId: input.themeId,
      slideCount: slides.length,
      payload: JSON.parse(JSON.stringify(slides)),
      createdById: userId,
    },
    select: { id: true },
  });
  return { ok: true, id: row.id };
}

export async function deleteSlideTemplate(userId: string, id: string): Promise<TemplateResult> {
  const row = await readableTemplate(userId, id);
  if (!row) return fail(404, "Template not found.");
  if (row.createdById !== userId && !(await isCore(userId))) return fail(403, "Only the person who saved a template or Core can delete it.");
  await prisma.slideTemplate.delete({ where: { id } });
  return { ok: true };
}

export function isBlankDeck(read: DeckRead): boolean {
  return read.slides.every((s) =>
    s.elements.every((e) => e.slot !== null && (e.kind === "text" ? e.blocks.length === 0 : !e.src)),
  );
}

/**
 * Fills a deck from a template: its theme and slides. A deck with nothing in it is emptied first, so a new deck
 * doesn't keep its blank starter slide; a deck with content keeps its slides and the template's go after them.
 */
export async function applyDeckTemplate(userId: string, pageId: string, templateId: string, request?: Request): Promise<TemplateResult<{ slideIds: string[] }>> {
  const access = await deckAccess(userId, pageId, request);
  if (!access.ok) return access;
  if (!access.canEdit) return fail(403, "You can view this deck but not edit it.");
  const found = await getSlideTemplate(userId, templateId);
  if (!found.ok) return found;
  if ((await deckStorage(pageId)) !== "yjs" && (await migrateDeckOnOpen(userId, pageId, request)) !== "yjs") {
    return fail(400, "Turn on the live deck editor to start from a template.");
  }
  const blank = isBlankDeck(await readDeckModel(pageId));
  let slideIds: string[] = [];
  await transactDeck(pageId, userId, (doc: Y.Doc) => {
    if (blank) {
      slidesMap(doc).forEach((slide) => {
        if (!isDeleted(slide)) tombstoneSlide(slide);
      });
      setThemeId(doc, found.template.themeId);
    }
    slideIds = pasteSlides(doc, found.template.slides, null);
  });
  await prisma.page.update({ where: { id: pageId }, data: { lastEditedById: userId } });
  return { ok: true, slideIds };
}
