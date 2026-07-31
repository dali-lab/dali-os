import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";

// Question.data.body for `type: "info"` is a BlockNote block array for rows
// written after the BlockNote migration (and for legacy ProseMirror rows,
// which loaders convert on read — see ~/lib/question-blocks.server.ts), and a
// plain string for legacy rows written before the rich-text upgrade. The
// helpers here paper over the shape difference so callers don't have to.
//
// Conversion point: ensureBlocks is server-only (node:crypto), so raw
// ProseMirror JSON must never reach this component — every loader serving a
// question array runs normalizeQuestionBodies first. A PM doc that slips
// through renders as empty (isEmptyBlocks treats non-arrays as empty).

export function hasInfoBody(body: unknown): boolean {
  if (typeof body === "string") return body.trim().length > 0;
  return !isEmptyBlocks(body);
}

export function InfoBody({ body }: { body: unknown }) {
  if (typeof body === "string") {
    if (!body.trim()) return null;
    return <p className="whitespace-pre-wrap">{body}</p>;
  }
  if (isEmptyBlocks(body)) return null;
  return <DocEditor editable={false} density="compact" initialContent={body} />;
}
