/** Where a Drive page opens: its own surface for canvases and decks, the document editor otherwise. */
export function pageOpenHref(kind: string | null | undefined, id: string): string {
  if (kind === "Whiteboard") return `/whiteboard/${id}`;
  if (kind === "Slides") return `/slides/${id}`;
  return `/documents/${id}`;
}
