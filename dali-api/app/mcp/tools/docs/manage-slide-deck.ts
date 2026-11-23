import type * as Y from "yjs";
import { McpError, requireForAction } from "../../errors";
import { prisma } from "~/lib/db.server";
import { announceAgent, pagePresenceRoom } from "~/collab/agent-presence.server";
import { deckAccess, readDeckModel, type DeckResult } from "~/lib/slide-decks.server";
import { transactDeck } from "~/collab/deck-live.server";
import { slidesRoomName } from "~/collab/roomName";
import type { DeckRead, DeckReadSlide } from "~/collab/read-deck.server";
import { richDocToMarkdown } from "~/components/slides/slide-markdown.server";
import { setThemeId, deleteSlide, moveSlide } from "~/components/slides/deck/deck-ops";
import { isDeleted, slidesMap, tombstoneSlide } from "~/components/slides/deck/model";
import {
  DECK_ACTIONS,
  ELEMENT_INPUT_SCHEMA,
  HTML_NOTE,
  LAYOUT_IDS,
  THEME_IDS,
  exportLinks,
  liveSlide,
  slideView,
  runDeckAction,
  type DeckAction,
  type DeckArgs,
} from "./slide-deck-elements";
import { pageArray, pageProps, type PageArgs } from "../../pagination";
import {
  OUTLINE_SLIDE_SCHEMA,
  MAX_OUTLINE_SLIDES,
  prepareOutline,
  prepareSlideUpdate,
  writeOutline,
  writeSlideUpdate,
  type OutlineSlide,
} from "./slide-outline";
import { runCreateLabDocument } from "./lab-documents";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

const SLIDE_ACTIONS = ["create", "set_slides", "add_slides", "update_slide", "delete_slide", "move_slide", "duplicate_slide", "set_layout", "set_theme"] as const;
const ELEMENT_ACTIONS = ["add_element", "update_element", "delete_elements", "duplicate_elements", "reorder_elements", "group_elements", "ungroup_elements", "align_elements", "distribute_elements", "snap_back"] as const;
const ACTIONS = ["get", "export", ...SLIDE_ACTIONS, ...ELEMENT_ACTIONS] as const;
type Action = (typeof ACTIONS)[number];

const pageIdProp = { type: "string", minLength: 1, description: "The deck's page id." };
const slideIdProp = { type: "string", description: "The slide to act on." };

export const GET_SLIDE_DECK_TOOL_DEF = {
  name: "get_slide_deck",
  description:
    "Read a Drive slide deck. Returns slides in pages of limit: pass page.nextCursor as cursor until page.hasMore is false (page.total is the slide count). Pass elements: true to also get the theme, each slide's layoutId and its elements (text boxes, images, shapes, charts, icons, videos, polls, custom HTML and layout boxes, whose id is their slot name). Pass exportLinks: true to get PDF and PowerPoint download links instead. Edit slides with manage_slide_deck and elements with manage_slide_elements. Version history is list_collab_versions with docName 'slides:{pageId}:deck'.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pageId: pageIdProp,
      elements: { type: "boolean", description: "Also return the theme, each slide's layoutId and its elements. A custom HTML element comes back with htmlLength and a short htmlPreview." },
      includeHtml: { type: "boolean", description: "With elements: return each custom HTML element's full source as html instead of the preview." },
      exportLinks: { type: "boolean", description: "Return PDF and PowerPoint download links instead of the slides." },
      ...pageProps(PAGE_LIMITS),
    },
    required: ["pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export const MANAGE_SLIDE_DECK_TOOL_DEF = {
  name: "manage_slide_deck",
  description:
    "Create or edit a Drive slide deck. Slides are written as outline slides: a layoutId, text per box in slots, notes and free elements. Actions: create (a new lab deck from an outline; returns pageId and every slide with its element ids) · set_slides (replace every slide with an outline) · add_slides (add outline slides at index, else at the end) · update_slide (change one slide from an outline slide; fields left out are kept, including its notes) · delete_slide · move_slide (to toIndex) · duplicate_slide · set_layout · set_theme. Bodies are Markdown, including pipe tables and fenced code blocks. An outline slide with html makes a slide whose content is your own HTML, CSS and script. " + HTML_NOTE + " Read the deck with get_slide_deck; edit what's on a slide with manage_slide_elements. set_slides, update_slide, delete_slide and move_slide return the whole deck; the others return what they changed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: [...SLIDE_ACTIONS] },
      pageId: { ...pageIdProp, description: "The deck's page id. Every action except create." },
      title: { type: "string", minLength: 1, maxLength: 200, description: "create: the new deck's title." },
      parentPageId: { type: "string", description: "create: put the deck inside an existing top-level Lab folder. Omit for the top level." },
      slide: { ...OUTLINE_SLIDE_SCHEMA, description: "update_slide: the changes to the slide. Fields left out are kept. Free elements are added to the slide; html is not taken." },
      slideId: { ...slideIdProp, description: "update_slide, delete_slide, move_slide, duplicate_slide and set_layout." },
      index: { type: "number", minimum: 0, description: "add_slides: where to insert, 0-based." },
      toIndex: { type: "number", minimum: 0, description: "move_slide: the new 0-based position." },
      outline: { type: "array", items: OUTLINE_SLIDE_SCHEMA, minItems: 1, maxItems: MAX_OUTLINE_SLIDES, description: "create and set_slides: the deck's slides, in order. add_slides: the slides to add, in order, at index (the end when left out)." },
      themeId: { type: "string", enum: THEME_IDS, description: "create (defaults to the standard dark theme) and set_theme." },
      layoutId: { type: "string", enum: LAYOUT_IDS, description: "set_layout." },
      ...pageProps(PAGE_LIMITS),
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export const MANAGE_SLIDE_ELEMENTS_TOOL_DEF = {
  name: "manage_slide_elements",
  description:
    "Edit what's on one slide of a Drive slide deck: text boxes, images, shapes, charts (with data), icons, videos, polls, custom HTML and layout boxes. Actions: add_element · update_element (text, style, image, fill, place on the 1920 by 1080 stage, build step; fields left out are kept) · delete_elements · duplicate_elements · reorder_elements · group_elements · ungroup_elements · align_elements · distribute_elements · snap_back (return layout boxes to their layout). Layout boxes have their slot name as id (title, subtitle, body, image); update_element with a slot name sets that box's text. delete_elements removes a layout box only once it is empty (an image box loses its picture first); manage_slide_deck set_layout, snap_back or update_element on its slot name brings it back. Text is Markdown, including pipe tables and fenced code blocks. Custom HTML: kind 'html' with html. " + HTML_NOTE + " Polls only work while presenting. Get element ids from get_slide_deck with elements: true. Returns the slide it changed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: [...ELEMENT_ACTIONS] },
      pageId: pageIdProp,
      slideId: slideIdProp,
      element: { ...ELEMENT_INPUT_SCHEMA, description: "add_element and update_element: the element's fields." },
      elementId: { type: "string", description: "update_element." },
      elementIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 200, description: "The elements the other actions act on. A group id stands for its items." },
      direction: { type: "string", enum: ["forward", "backward", "front", "back"], description: "reorder_elements." },
      align: { type: "string", enum: ["left", "center", "right", "top", "middle", "bottom"], description: "align_elements." },
      relativeTo: { type: "string", enum: ["slide", "selection"], description: "align_elements: defaults to the selection for several elements, the slide for one." },
      axis: { type: "string", enum: ["x", "y"], description: "distribute_elements: x spaces them across, y down. Needs three or more." },
    },
    required: ["action", "pageId", "slideId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const DECK_ACTION_REQUIRED: Record<string, string[]> = {
  get: [],
  set_slides: ["outline"],
  update_slide: ["slideId", "slide"],
  delete_slide: ["slideId"],
  move_slide: ["slideId", "toIndex"],
  export: [],
  add_slides: ["outline"],
  set_theme: ["themeId"],
  set_layout: ["slideId", "layoutId"],
  duplicate_slide: ["slideId"],
  add_element: ["slideId", "element"],
  update_element: ["slideId", "elementId", "element"],
  delete_elements: ["slideId", "elementIds"],
  duplicate_elements: ["slideId", "elementIds"],
  reorder_elements: ["slideId", "elementIds", "direction"],
  group_elements: ["slideId", "elementIds"],
  ungroup_elements: ["slideId", "elementIds"],
  align_elements: ["slideId", "elementIds", "align"],
  distribute_elements: ["slideId", "elementIds", "axis"],
  snap_back: ["slideId", "elementIds"],
};

const ACTION_REQUIRED: Record<string, string[]> = {
  create: ["title", "outline"],
  ...Object.fromEntries(Object.entries(DECK_ACTION_REQUIRED).map(([action, fields]) => [action, ["pageId", ...fields]])),
};

type Args = PageArgs & Omit<DeckArgs, "pageId"> & {
  action: Action;
  pageId?: string;
  title?: string;
  parentPageId?: string;
  slide?: OutlineSlide;
  slideId?: string;
  outline?: OutlineSlide[];
  index?: number;
  toIndex?: number;
  elements?: boolean;
  includeHtml?: boolean;
};

function unwrap<T extends object>(result: DeckResult<T>): T {
  if (!result.ok) throw new McpError(result.error, result.status);
  return result;
}

const slotsOf = async (slide: DeckReadSlide) => {
  const slots: Record<string, string | { src: string; alt: string }> = {};
  for (const el of slide.elements) {
    if (el.slot === null) continue;
    if (el.kind === "text") {
      const markdown = await richDocToMarkdown(el.blocks as never);
      if (markdown) slots[el.slot] = markdown;
    } else if (el.kind === "image" && el.src) slots[el.slot] = { src: el.src, alt: el.alt ?? "" };
  }
  return slots;
};

async function slideSummary(slide: DeckReadSlide) {
  return { id: slide.id, layoutId: slide.layoutId, slots: await slotsOf(slide), ...(slide.notes.text ? { notes: slide.notes.text } : {}) };
}

async function deckOutput(title: string, read: DeckRead) {
  return { title, themeId: read.themeId, slides: await Promise.all(read.slides.map(slideSummary)) };
}

type SlideAction = "get" | "set_slides" | "update_slide" | "delete_slide" | "move_slide";
type SlideOutputDeck = { title: string; themeId: string; slides: Awaited<ReturnType<typeof slideSummary>>[]; page?: ReturnType<typeof pageArray>["page"] };

async function createDeck(userId: string, args: Args) {
  if (args.themeId !== undefined && !THEME_IDS.includes(args.themeId)) throw new McpError(`themeId must be one of: ${THEME_IDS.join(", ")}.`, 400);
  const prepared = await prepareOutline(args.outline!);
  const { id } = await runCreateLabDocument(userId, { title: args.title!, kind: "Slides", parentPageId: args.parentPageId });
  let slideIds: string[] = [];
  await transactDeck(id, userId, (doc) => {
    clearSlides(doc);
    if (args.themeId) setThemeId(doc, args.themeId);
    slideIds = writeOutline(doc, prepared);
  });
  await prisma.page.update({ where: { id }, data: { lastEditedById: userId } });
  const read = await readDeckModel(id);
  const created = slideIds.map((sid) => read.slides.find((s) => s.id === sid)!).filter(Boolean);
  return { pageId: id, title: args.title, themeId: read.themeId, slides: await Promise.all(created.map((s) => slideView(s))) };
}

function clearSlides(doc: Y.Doc): void {
  slidesMap(doc).forEach((slide) => {
    if (!isDeleted(slide)) tombstoneSlide(slide);
  });
}

async function editDeck(userId: string, pageId: string, title: string, mutate: (doc: Y.Doc) => void) {
  await transactDeck(pageId, userId, mutate);
  await prisma.page.update({ where: { id: pageId }, data: { lastEditedById: userId } });
  return deckOutput(title, await readDeckModel(pageId));
}

export function runManageSlideDeck(userId: string, args: Args & { action: "create" }): ReturnType<typeof createDeck>;
export function runManageSlideDeck(userId: string, args: Args & { action: SlideAction }): Promise<SlideOutputDeck>;
export function runManageSlideDeck(userId: string, args: Args): Promise<object>;
export async function runManageSlideDeck(userId: string, input: Args) {
  requireForAction(input.action, input as unknown as Record<string, unknown>, ACTION_REQUIRED);
  if (input.action === "create") return createDeck(userId, input);
  const args = input as Args & { pageId: string };
  const { page, canEdit } = unwrap(await deckAccess(userId, args.pageId));
  if (args.action === "get" || args.action === "export") void announceAgent({ action: "reading", presenceRoom: pagePresenceRoom(args.pageId) });

  if (args.action === "get") {
    const read = await readDeckModel(args.pageId);
    const { rows, page: pageInfo } = pageArray(read.slides, args, PAGE_LIMITS);
    const out = { ...(await deckOutput(page.title, { ...read, slides: rows })), page: pageInfo };
    if (!args.elements) return out;
    const views = await Promise.all(rows.map((s) => slideView(s, { includeHtml: args.includeHtml === true })));
    return { ...out, docName: slidesRoomName(args.pageId), slides: out.slides.map((s, i) => ({ ...s, ...views[i] })) };
  }

  if (args.action === "export") return { title: page.title, ...exportLinks(args.pageId, canEdit) };

  if (!canEdit) throw new McpError("You can view this deck but not edit it.", 403);

  if (args.action === "add_slides") {
    const prepared = await prepareOutline(args.outline!);
    let slideIds: string[] = [];
    await transactDeck(args.pageId, userId, (doc) => {
      slideIds = writeOutline(doc, prepared, args.index);
    });
    await prisma.page.update({ where: { id: args.pageId }, data: { lastEditedById: userId } });
    const read = await readDeckModel(args.pageId);
    const added = read.slides.filter((s) => slideIds.includes(s.id)).sort((a, b) => slideIds.indexOf(a.id) - slideIds.indexOf(b.id));
    return { title: page.title, slideIds, slides: await Promise.all(added.map((s) => slideView(s))) };
  }

  if ((DECK_ACTIONS as readonly string[]).includes(args.action)) {
    return { title: page.title, ...(await runDeckAction(userId, args.action as DeckAction, args)) };
  }

  switch (args.action) {
    case "set_slides": {
      const prepared = await prepareOutline(args.outline!);
      return editDeck(userId, args.pageId, page.title, (doc) => {
        clearSlides(doc);
        writeOutline(doc, prepared);
      });
    }
    case "update_slide": {
      const current = (await readDeckModel(args.pageId)).slides.find((s) => s.id === args.slideId);
      if (!current) throw new McpError("Slide not found.", 404);
      const prepared = await prepareSlideUpdate(args.slide!, current.layoutId);
      return editDeck(userId, args.pageId, page.title, (doc) => {
        liveSlide(doc, args.slideId);
        writeSlideUpdate(doc, args.slideId!, prepared);
      });
    }
    case "delete_slide":
      return editDeck(userId, args.pageId, page.title, (doc) => {
        liveSlide(doc, args.slideId);
        deleteSlide(doc, args.slideId!, userId);
      });
    case "move_slide":
      return editDeck(userId, args.pageId, page.title, (doc) => {
        liveSlide(doc, args.slideId);
        moveSlide(doc, args.slideId!, Math.max(Math.trunc(args.toIndex!), 0));
      });
    default:
      throw new McpError(`Unknown action '${args.action}'.`, 400);
  }
}

export function runGetSlideDeck(userId: string, args: PageArgs & { pageId: string; elements?: boolean; includeHtml?: boolean; exportLinks?: boolean }) {
  const { exportLinks: wantsExport, ...rest } = args;
  return runManageSlideDeck(userId, { ...rest, action: wantsExport ? "export" : "get" });
}
