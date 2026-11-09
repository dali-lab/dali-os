import * as Y from "yjs";

// The server schema has no `comment` mark, so y-prosemirror deletes commented
// text while decoding. Only ever call this on a throwaway clone of a doc.
export function stripCommentFormats(element: Y.XmlFragment | Y.XmlElement): void {
  for (let i = 0; i < element.length; i++) {
    const child = element.get(i);
    if (child instanceof Y.XmlText) {
      const delta = child.toDelta() as Array<{
        insert?: unknown;
        attributes?: Record<string, unknown>;
      }>;
      let pos = 0;
      for (const op of delta) {
        const len = typeof op.insert === "string" ? op.insert.length : 1;
        const commentKeys = Object.keys(op.attributes ?? {}).filter((k) => k.startsWith("comment"));
        if (commentKeys.length > 0) {
          child.format(pos, len, Object.fromEntries(commentKeys.map((k) => [k, null])));
        }
        pos += len;
      }
    } else if (child instanceof Y.XmlElement) {
      stripCommentFormats(child);
    }
  }
}
