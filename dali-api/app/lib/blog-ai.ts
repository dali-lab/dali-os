// Which parts of a blog post the AI tools rewrite. The tools round-trip text
// through Markdown, so they only take runs of plain text blocks: an image, a
// table, a component or a mention can't survive that trip and is left exactly
// as it is. Pure, so its test needs no editor.

/** Text per request, sized so /api/ai/email returns each passage whole. */
export const POST_PASSAGE_CHARS = 3000;

const TEXT_BLOCKS = new Set([
  "paragraph",
  "heading",
  "quote",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
]);

export type AiBlock = { id: string; type: string; content?: unknown; children?: AiBlock[] };

/** A block's text length, or null when it holds something Markdown would lose. */
function textLength(block: AiBlock): number | null {
  if (!TEXT_BLOCKS.has(block.type) || !Array.isArray(block.content)) return null;
  let length = 0;
  for (const inline of block.content as { type?: string; text?: string; content?: unknown }[]) {
    if (inline.type === "text") length += inline.text?.length ?? 0;
    else if (inline.type === "link" && Array.isArray(inline.content)) {
      for (const part of inline.content as { text?: string }[]) length += part.text?.length ?? 0;
    } else return null;
  }
  for (const child of block.children ?? []) {
    const childLength = textLength(child);
    if (childLength === null) return null;
    length += childLength;
  }
  return length;
}

/** Runs of consecutive top-level text blocks, as block ids, in document order. */
export function aiPassages(blocks: AiBlock[], maxChars = POST_PASSAGE_CHARS): string[][] {
  const passages: string[][] = [];
  let run: { id: string; length: number }[] = [];
  let size = 0;
  const close = () => {
    // Blank lines at either end carry nothing to rewrite.
    while (run.length && run[run.length - 1]!.length === 0) run.pop();
    if (run.length) passages.push(run.map((b) => b.id));
    run = [];
    size = 0;
  };
  for (const block of blocks) {
    const length = textLength(block);
    if (length === null) {
      close();
      continue;
    }
    if (run.length > 0 && size + length > maxChars) close();
    if (run.length === 0 && length === 0) continue;
    run.push({ id: block.id, length });
    size += length;
  }
  close();
  return passages;
}
