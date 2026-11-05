import * as Y from "yjs";
import type { RichDoc } from "~/components/slides/types";
import { fragmentToRichDoc } from "./fragment-blocks";
import {
  comparePos,
  compareZ,
  deckMap,
  elementsOf,
  isDeleted,
  restoreEpochOf,
  slidesMap,
  textOf,
  type SlideMap,
} from "./model";
import { buildOf } from "./builds";
import { TEXT_STYLE_IDS, type TextStyleId } from "./themes";

export interface RenderElement {
  id: string;
  kind: string;
  slot: string | null;
  z: number;
  blocks: RichDoc;
  src: string | null;
  alt: string | null;
  textStyle: TextStyleId | null;
  /** The step this element appears at. Absent means it is there from the start. */
  build?: number;
  /** A text slot whose top-level blocks appear one per step after its own step. */
  buildBullets?: boolean;
}

export interface RenderSlide {
  id: string;
  pos: number;
  layoutId: string;
  elements: RenderElement[];
}

export interface DeckSnapshot {
  v: unknown;
  themeId: string;
  epoch: number;
  slides: RenderSlide[];
  deletedIds: string[];
  /** Who tombstoned each deleted slide, when they said. */
  deletedBy: Record<string, string | null>;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function snapshotSlide(id: string, slide: SlideMap): RenderSlide {
  const fragments = textOf(slide);
  const elements: RenderElement[] = [];
  elementsOf(slide).forEach((el, elId) => {
    if (isDeleted(el)) return;
    const style = el.get("textStyle");
    const build = buildOf(el.get("build"));
    elements.push({
      id: elId,
      kind: String(el.get("kind")),
      slot: str(el.get("slot")),
      z: Number(el.get("z") ?? 0),
      blocks: fragmentToRichDoc(fragments.get(elId)),
      src: str(el.get("src")),
      alt: str(el.get("alt")),
      textStyle: TEXT_STYLE_IDS.includes(style as TextStyleId) ? (style as TextStyleId) : null,
      ...(build ? { build } : {}),
      ...(el.get("buildBullets") === true ? { buildBullets: true } : {}),
    });
  });
  elements.sort(compareZ);
  return { id, pos: Number(slide.get("pos") ?? 0), layoutId: String(slide.get("layoutId") ?? "content"), elements };
}

export function snapshotDeck(doc: Y.Doc): DeckSnapshot {
  const slides: RenderSlide[] = [];
  const deletedIds: string[] = [];
  const deletedBy: Record<string, string | null> = {};
  slidesMap(doc).forEach((slide, id) => {
    if (isDeleted(slide)) {
      deletedIds.push(id);
      deletedBy[id] = str(slide.get("deletedBy"));
    } else slides.push(snapshotSlide(id, slide));
  });
  slides.sort(comparePos);
  return { ...deckFields(doc), slides, deletedIds, deletedBy };
}

export function deckFields(doc: Y.Doc): Pick<DeckSnapshot, "v" | "themeId" | "epoch"> {
  const themeId = deckMap(doc).get("themeId");
  return { v: deckMap(doc).get("v"), themeId: typeof themeId === "string" ? themeId : "dali-dark", epoch: restoreEpochOf(doc) };
}
