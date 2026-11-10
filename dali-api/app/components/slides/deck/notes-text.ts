import type * as Y from "yjs";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import { fragmentToRichDoc } from "./fragment-blocks";
import { isDeleted, notesOf, slidesMap } from "./model";

export function notesTextBySlide(doc: Y.Doc): Record<string, string> {
  const out: Record<string, string> = {};
  slidesMap(doc).forEach((slide, id) => {
    if (!isDeleted(slide)) out[id] = blocksToPlainText(fragmentToRichDoc(notesOf(slide)) as never);
  });
  return out;
}
