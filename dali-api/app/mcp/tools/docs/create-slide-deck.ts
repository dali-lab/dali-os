import { McpError } from "../../errors";
import { prisma } from "~/lib/db.server";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { migrateDeckOnOpen, readDeckModel } from "~/lib/slide-decks.server";
import { transactDeck } from "~/collab/deck-live.server";
import { setThemeId } from "~/components/slides/deck/deck-ops";
import { isDeleted, slidesMap, tombstoneSlide } from "~/components/slides/deck/model";
import { HTML_NOTE, slideView, THEME_IDS } from "./slide-deck-elements";
import { MAX_OUTLINE_SLIDES, OUTLINE_SLIDE_SCHEMA, prepareOutline, writeOutline, type OutlineSlide } from "./slide-outline";
import { runCreateLabDocument } from "./lab-documents";

export const CREATE_SLIDE_DECK_TOOL_DEF = {
  name: "create_slide_deck",
  description:
    "Create a lab slide deck from an outline in one step. Each slide has a layoutId, its text by box name in slots (Markdown), speaker notes, and free elements (text, image by URL, shape, chart with data, icon, video, poll, custom HTML) as in manage_slide_deck add_element. A slide can instead be one custom HTML page: give it html (a Blank-layout slide filled by your HTML). " + HTML_NOTE + " Returns the deck's pageId and every slide with its element ids; edit it afterwards with manage_slide_deck. Needs the live deck editor to be on for you.",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      themeId: { type: "string", enum: THEME_IDS, description: "Defaults to the standard dark theme." },
      parentPageId: { type: "string", description: "Put the deck inside an existing top-level Lab folder. Omit for the top level." },
      slides: { type: "array", items: OUTLINE_SLIDE_SCHEMA, minItems: 1, maxItems: MAX_OUTLINE_SLIDES, description: "The slides, in order." },
    },
    required: ["title", "slides"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { title: string; themeId?: string; parentPageId?: string; slides: OutlineSlide[] };

export async function runCreateSlideDeck(userId: string, input: Input) {
  if (input.themeId !== undefined && !THEME_IDS.includes(input.themeId)) throw new McpError(`themeId must be one of: ${THEME_IDS.join(", ")}.`, 400);
  const prepared = await prepareOutline(input.slides);
  if (!(await isFeatureEnabled("slides-collab", userId, await getUserRoles(userId)))) {
    throw new McpError("The live deck editor isn't on for you, so a deck can't be drafted from an outline.", 400);
  }
  const { id } = await runCreateLabDocument(userId, { title: input.title, kind: "Slides", parentPageId: input.parentPageId });
  if ((await migrateDeckOnOpen(userId, id)) !== "yjs") throw new McpError("The new deck couldn't be opened for editing.", 500);
  let slideIds: string[] = [];
  await transactDeck(id, userId, (doc) => {
    slidesMap(doc).forEach((slide) => {
      if (!isDeleted(slide)) tombstoneSlide(slide);
    });
    if (input.themeId) setThemeId(doc, input.themeId);
    slideIds = writeOutline(doc, prepared);
  });
  await prisma.page.update({ where: { id }, data: { lastEditedById: userId } });
  const read = await readDeckModel(id);
  const created = slideIds.map((sid) => read.slides.find((s) => s.id === sid)!).filter(Boolean);
  return { pageId: id, title: input.title, themeId: read.themeId, slides: await Promise.all(created.map((s) => slideView(s))) };
}
