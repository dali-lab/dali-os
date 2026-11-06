import { McpError, requireForAction } from "../../errors";
import { prisma } from "~/lib/db.server";
import { deckAccess, deckStorage, editDeck, loadDeck, migrateDeckOnOpen, readDeckModel, type DeckResult } from "~/lib/slide-decks.server";
import { parseSlides } from "~/components/slides/slide-schema";
import { applySlides } from "~/collab/deck-write.server";
import { transactDeck } from "~/collab/deck-live.server";
import {
  SLIDE_INPUT_SCHEMA,
  applySlideInput,
  slideToOutput,
  type SlideInput,
  type SlideOutput,
} from "~/components/slides/slide-markdown.server";
import { moveItem } from "~/components/slides/slide-edit";
import { setLayout } from "~/components/slides/deck/deck-ops";
import {
  DECK_ACTIONS,
  ELEMENT_INPUT_SCHEMA,
  LAYOUT_IDS,
  THEME_IDS,
  deckModelView,
  exportLinks,
  slideView,
  runDeckAction,
  type DeckAction,
  type DeckArgs,
} from "./slide-deck-elements";
import type { Slide } from "~/components/slides/types";
import { pageArray, pageProps, type PageArgs } from "../../pagination";
import { OUTLINE_SLIDE_SCHEMA, MAX_OUTLINE_SLIDES, prepareOutline, writeOutline, type OutlineSlide } from "./slide-outline";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

const ACTIONS = ["get", "set_slides", "add_slide", "update_slide", "delete_slide", "move_slide", "export", "add_slides", ...DECK_ACTIONS] as const;
type Action = (typeof ACTIONS)[number];

export const MANAGE_SLIDE_DECK_TOOL_DEF = {
  name: "manage_slide_deck",
  description:
    "Read or edit a Drive slide deck. Slide actions: get · set_slides (replace every slide) · add_slide (optional index, else at the end; layoutId for any layout) · update_slide (fields left out are kept) · delete_slide · move_slide (to toIndex) · duplicate_slide · set_layout. Deck: set_theme · add_slides (draft several slides at once from an outline: each has a layoutId, text per box in slots, notes and free elements) · export (PDF and PowerPoint download links). Elements, the text boxes, images, shapes, charts (with data), icons, videos, polls and layout boxes on a slide: add_element · update_element (text, style, image, fill, place on the 1920 by 1080 stage, build step; fields left out are kept) · delete_elements · duplicate_elements · reorder_elements · group_elements · ungroup_elements · align_elements · distribute_elements · snap_back (return layout boxes to their layout). Layout boxes have their slot name as id (title, subtitle, body, image); update_element with a slot name sets that box's text. delete_elements removes a layout box only once it is empty (an image box loses its picture first); set_layout, snap_back or update_element on its slot name brings it back. Bodies and text are Markdown, including pipe tables and fenced code blocks. To draft a whole deck from an outline, use create_slide_deck. Polls only work while presenting. Create a deck with create_lab_document kind 'Slides'. get returns slides in pages of limit: pass page.nextCursor as cursor until page.hasMore is false (page.total is the slide count); pass elements: true to also get the theme, each slide's layoutId and its elements. The slide actions return the whole deck; the element, layout and theme actions return the slide they changed. Version history is list_collab_versions with docName 'slides:{pageId}:deck'.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: [...ACTIONS] },
      pageId: { type: "string", minLength: 1, description: "The deck's page id." },
      slides: { type: "array", items: SLIDE_INPUT_SCHEMA, maxItems: 300, description: "set_slides: the whole deck, in order." },
      slide: { ...SLIDE_INPUT_SCHEMA, description: "add_slide and update_slide: the slide's fields." },
      slideId: { type: "string", description: "update_slide, delete_slide and move_slide." },
      index: { type: "number", minimum: 0, description: "add_slide: where to insert, 0-based." },
      toIndex: { type: "number", minimum: 0, description: "move_slide: the new 0-based position." },
      outline: { type: "array", items: OUTLINE_SLIDE_SCHEMA, minItems: 1, maxItems: MAX_OUTLINE_SLIDES, description: "add_slides: the slides to add, in order, at index (the end when left out)." },
      elements: { type: "boolean", description: "get: also return the theme, each slide's layoutId and its elements." },
      themeId: { type: "string", enum: THEME_IDS, description: "set_theme." },
      layoutId: { type: "string", enum: LAYOUT_IDS, description: "set_layout, and add_slide for layouts beyond the four in slide.layout." },
      element: { ...ELEMENT_INPUT_SCHEMA, description: "add_element and update_element: the element's fields." },
      elementId: { type: "string", description: "update_element." },
      elementIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 200, description: "The elements the other element actions act on. A group id stands for its items." },
      direction: { type: "string", enum: ["forward", "backward", "front", "back"], description: "reorder_elements." },
      align: { type: "string", enum: ["left", "center", "right", "top", "middle", "bottom"], description: "align_elements." },
      relativeTo: { type: "string", enum: ["slide", "selection"], description: "align_elements: defaults to the selection for several elements, the slide for one." },
      axis: { type: "string", enum: ["x", "y"], description: "distribute_elements: x spaces them across, y down. Needs three or more." },
      ...pageProps(PAGE_LIMITS),
    },
    required: ["action", "pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = PageArgs & Omit<DeckArgs, "pageId"> & {
  action: Action;
  pageId: string;
  slides?: SlideInput[];
  slide?: SlideInput;
  slideId?: string;
  outline?: OutlineSlide[];
  index?: number;
  toIndex?: number;
  elements?: boolean;
};

function unwrap<T extends object>(result: DeckResult<T>): T {
  if (!result.ok) throw new McpError(result.error, result.status);
  return result;
}

function indexOfSlide(slides: Slide[], slideId: string): number {
  const at = slides.findIndex((s) => s.id === slideId);
  if (at < 0) throw new McpError("Slide not found.", 404);
  return at;
}

async function deckOutput(title: string, slides: Slide[], version: string) {
  return { title, version, slides: await Promise.all(slides.map(slideToOutput)) };
}

type SlideAction = "get" | "set_slides" | "add_slide" | "update_slide" | "delete_slide" | "move_slide";
type SlideOutputDeck = { title: string; version: string; slides: SlideOutput[]; page?: ReturnType<typeof pageArray>["page"] };

export function runManageSlideDeck(userId: string, args: Args & { action: SlideAction }): Promise<SlideOutputDeck>;
export function runManageSlideDeck(userId: string, args: Args): Promise<object>;
export async function runManageSlideDeck(userId: string, args: Args) {
  requireForAction(args.action, args as unknown as Record<string, unknown>, {
    get: [],
    set_slides: ["slides"],
    add_slide: ["slide"],
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
  });
  const { page, canEdit } = unwrap(await deckAccess(userId, args.pageId));

  if (args.action === "get") {
    const deck = await loadDeck(args.pageId);
    const { rows, page: pageInfo } = pageArray(deck.slides, args, PAGE_LIMITS);
    const out = { ...(await deckOutput(page.title, rows, deck.version)), page: pageInfo };
    if (!args.elements) return out;
    const model = await deckModelView(args.pageId, rows.map((s) => s.id));
    return {
      ...out,
      themeId: model.themeId,
      docName: model.docName,
      slides: out.slides.map((s, i) => ({ ...s, ...(model.slides[i] ?? {}) })),
    };
  }

  if (args.action === "add_slides") {
    if (!canEdit) throw new McpError("You can view this deck but not edit it.", 403);
    const prepared = await prepareOutline(args.outline!);
    if ((await migrateDeckOnOpen(userId, args.pageId)) !== "yjs") {
      throw new McpError("This deck still uses the older slides editor, which can't do that. Ask an admin to turn on the live deck editor.", 400);
    }
    let slideIds: string[] = [];
    await transactDeck(args.pageId, userId, (doc) => {
      slideIds = writeOutline(doc, prepared, args.index);
    });
    await prisma.page.update({ where: { id: args.pageId }, data: { lastEditedById: userId } });
    const read = await readDeckModel(args.pageId);
    const added = read.slides.filter((s) => slideIds.includes(s.id)).sort((a, b) => slideIds.indexOf(a.id) - slideIds.indexOf(b.id));
    return { title: page.title, slideIds, slides: await Promise.all(added.map(slideView)) };
  }

  if (args.action === "export") return { title: page.title, ...exportLinks(args.pageId, canEdit) };

  if ((DECK_ACTIONS as readonly string[]).includes(args.action)) {
    if (!canEdit) throw new McpError("You can view this deck but not edit it.", 403);
    return { title: page.title, ...(await runDeckAction(userId, args.action as DeckAction, args)) };
  }

  if (args.action === "add_slide" && args.layoutId !== undefined) {
    if (!LAYOUT_IDS.includes(args.layoutId)) throw new McpError(`layoutId must be one of: ${LAYOUT_IDS.join(", ")}.`, 400);
    if (!canEdit) throw new McpError("You can view this deck but not edit it.", 403);
    if ((await migrateDeckOnOpen(userId, args.pageId)) !== "yjs") {
      throw new McpError("This deck still uses the older slides editor, which only has the four layouts in slide.layout.", 400);
    }
  }
  let addedId: string | null = null;

  const edit = async (slides: Slide[]): Promise<Slide[]> => {
    switch (args.action) {
      case "set_slides":
        return Promise.all(args.slides!.map((s) => applySlideInput(s)));
      case "add_slide": {
        const added = await applySlideInput(args.slide!);
        addedId = added.id;
        const at = Math.min(args.index ?? slides.length, slides.length);
        return [...slides.slice(0, at), added, ...slides.slice(at)];
      }
      case "update_slide": {
        const at = indexOfSlide(slides, args.slideId!);
        const updated = await applySlideInput(args.slide!, slides[at]);
        return slides.map((s, i) => (i === at ? updated : s));
      }
      case "delete_slide": {
        indexOfSlide(slides, args.slideId!);
        return slides.filter((s) => s.id !== args.slideId);
      }
      case "move_slide": {
        const at = indexOfSlide(slides, args.slideId!);
        const to = Math.min(Math.max(Math.trunc(args.toIndex!), 0), slides.length - 1);
        return moveItem(slides, at, to - at);
      }
      default:
        throw new McpError(`Unknown action '${args.action}'.`, 400);
    }
  };

  if ((await deckStorage(args.pageId)) === "yjs") {
    if (!canEdit) throw new McpError("You can view this deck but not edit it.", 403);
    const next = await edit((await loadDeck(args.pageId)).slides);
    const valid = parseSlides(JSON.parse(JSON.stringify(next)));
    if (!valid) throw new McpError("That isn't a valid deck.", 400);
    await transactDeck(args.pageId, userId, (doc) => {
      applySlides(doc, valid);
      if (addedId && args.layoutId) setLayout(doc, addedId, args.layoutId);
    });
    await prisma.page.update({ where: { id: args.pageId }, data: { lastEditedById: userId } });
    const saved = await loadDeck(args.pageId);
    return deckOutput(page.title, saved.slides, saved.version);
  }

  const saved = unwrap(await editDeck(userId, args.pageId, edit));
  return deckOutput(page.title, saved.slides, saved.version);
}
