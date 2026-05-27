import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";

// Question.data.body for `type: "info"` is a ProseMirror JSON doc for rows
// written after the rich-text upgrade, and a plain string for legacy rows in
// older InternToFullFormVersion snapshots. The helpers here paper over the
// shape difference so callers don't have to.

export function hasInfoBody(body: unknown): boolean {
  if (typeof body === "string") return body.trim().length > 0;
  return !isEmptyDoc(body);
}

export function InfoBody({ body }: { body: unknown }) {
  if (typeof body === "string") {
    if (!body.trim()) return null;
    return <p className="whitespace-pre-wrap">{body}</p>;
  }
  if (isEmptyDoc(body)) return null;
  return <RichTextViewer content={body} />;
}
