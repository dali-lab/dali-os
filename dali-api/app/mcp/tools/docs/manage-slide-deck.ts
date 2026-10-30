// MCP tool: manage_slide_deck — read and edit a Drive slide deck (a Page of
// kind Slides). Every write goes through editDeck, the same compare-and-set
// save the /slides/:pageId editor uses. Create a deck with create_lab_document
// (kind "Slides"). Access: page view for get, page edit for the rest.

import { McpError, requireForAction } from "../../errors";
import { deckAccess, editDeck, loadDeck, type DeckResult } from "~/lib/slide-decks.server";
import {
  SLIDE_INPUT_SCHEMA,
  applySlideInput,
  slideToOutput,
  type SlideInput,
} from "~/components/slides/slide-markdown.server";
import { moveItem } from "~/components/slides/slide-edit";
import type { Slide } from "~/components/slides/types";
import { pageArray, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

const ACTIONS = ["get", "set_slides", "add_slide", "update_slide", "delete_slide", "move_slide"] as const;
type Action = (typeof ACTIONS)[number];

export const MANAGE_SLIDE_DECK_TOOL_DEF = {
  name: "manage_slide_deck",
  description:
    "Read or edit a Drive slide deck. Actions: get · set_slides (replace every slide) · add_slide (optional index, else at the end) · update_slide (fields left out are kept) · delete_slide · move_slide (to toIndex). Slide bodies are Markdown. Create a deck with create_lab_document kind 'Slides'. get returns slides in pages of limit: pass page.nextCursor as cursor until page.hasMore is false (page.total is the slide count). The edit actions return the whole deck.",
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
      ...pageProps(PAGE_LIMITS),
    },
    required: ["action", "pageId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = PageArgs & {
  action: Action;
  pageId: string;
  slides?: SlideInput[];
  slide?: SlideInput;
  slideId?: string;
  index?: number;
  toIndex?: number;
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

export async function runManageSlideDeck(userId: string, args: Args) {
  requireForAction(args.action, args as unknown as Record<string, unknown>, {
    get: [],
    set_slides: ["slides"],
    add_slide: ["slide"],
    update_slide: ["slideId", "slide"],
    delete_slide: ["slideId"],
    move_slide: ["slideId", "toIndex"],
  });
  const { page } = unwrap(await deckAccess(userId, args.pageId));

  if (args.action === "get") {
    const deck = await loadDeck(args.pageId);
    const { rows, page: pageInfo } = pageArray(deck.slides, args, PAGE_LIMITS);
    return { ...(await deckOutput(page.title, rows, deck.version)), page: pageInfo };
  }

  const saved = unwrap(
    await editDeck(userId, args.pageId, async (slides) => {
      switch (args.action) {
        case "set_slides":
          return Promise.all(args.slides!.map((s) => applySlideInput(s)));
        case "add_slide": {
          const added = await applySlideInput(args.slide!);
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
    }),
  );
  return deckOutput(page.title, saved.slides, saved.version);
}
