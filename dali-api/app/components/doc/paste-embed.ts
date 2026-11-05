import { parseVideoEmbed } from "~/lib/video-embed";
import { enhancePasteHandler } from "./enhance-render";
import type { DocEditorInstance } from "./schema/build";

export const PASTE_OFFER_EVENT = "dali:paste-offer";

export interface PasteOffer {
  blockId: string;
  url: string;
}

export type PasteEmbedType = "video" | "embed";

type InlineItem = { type: string; href?: string; text?: string };

function inlineItems(block: unknown): InlineItem[] {
  const content = (block as { content?: unknown }).content;
  return Array.isArray(content) ? content : [];
}

function pastedVideoUrl(data: DataTransfer | null): string | null {
  if (!data || data.types.includes("Files") || data.types.includes("blocknote/html")) return null;
  const text = data.getData("text/plain").trim();
  return text && !/\s/.test(text) && parseVideoEmbed(text) ? text : null;
}

function canOffer(editor: DocEditorInstance): boolean {
  return (
    "video" in editor.schema.blockSchema &&
    editor.prosemirrorState.selection.empty &&
    editor.getTextCursorPosition().block.type === "paragraph"
  );
}

export function docPasteHandler(context: {
  event: ClipboardEvent;
  editor: DocEditorInstance;
  defaultPasteHandler: Parameters<typeof enhancePasteHandler>[0]["defaultPasteHandler"];
}): boolean | undefined {
  const { event, editor } = context;
  const url = pastedVideoUrl(event.clipboardData);
  if (!url || !canOffer(editor)) return enhancePasteHandler(context);

  const blockId = editor.getTextCursorPosition().block.id;
  editor.insertInlineContent([{ type: "link", href: url, content: url }]);
  editor.domElement?.dispatchEvent(
    new CustomEvent<PasteOffer>(PASTE_OFFER_EVENT, { detail: { blockId, url } }),
  );
  return true;
}

export function offerIsCurrent(editor: DocEditorInstance, { blockId, url }: PasteOffer): boolean {
  const block = editor.getBlock(blockId);
  return !!block && inlineItems(block).some((item) => item.type === "link" && item.href === url);
}

function isAloneOnLine(block: unknown): boolean {
  return inlineItems(block).every(
    (item) => item.type === "link" || (item.type === "text" && !item.text?.trim()),
  );
}

/** Turns an offered link into a block. A link alone on its line is replaced; one
 * inside a sentence stays, so the sentence keeps its words, and the block lands
 * below it. Does nothing if the link has changed since the offer. */
export function applyPasteEmbed(
  editor: DocEditorInstance,
  offer: PasteOffer,
  type: PasteEmbedType,
): void {
  if (!offerIsCurrent(editor, offer)) return;
  const block = editor.getBlock(offer.blockId)!;
  const media = { type, props: { url: offer.url } } as never;

  editor.transact(() => {
    const placed = isAloneOnLine(block)
      ? editor.updateBlock(block, media)
      : editor.insertBlocks([media], block, "after")[0]!;
    const next = editor.getNextBlock(placed);
    const nextIsBlank = next?.type === "paragraph" && inlineItems(next).length === 0;
    const line = nextIsBlank
      ? next
      : editor.insertBlocks([{ type: "paragraph" }], placed, "after")[0]!;
    editor.setTextCursorPosition(line, "start");
  });
  editor.focus();
}
