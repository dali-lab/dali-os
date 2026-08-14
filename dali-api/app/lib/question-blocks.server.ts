// Server-side normalization of rich `info` bodies inside Question arrays.
//
// Question.data.body for `type: "info"` rows is (a) a plain string on legacy
// rows, (b) legacy ProseMirror JSON on rows written by the old Tiptap editor,
// or (c) a BlockNote block array going forward. Published version rows
// (FormVersion / ShortformVersion / ChallengeVersion questions) are
// immutable, so the PM→BlockNote conversion happens on read — every loader
// that serves a question array to a fill/preview surface runs it through this
// before returning. The client (InfoBody) then only ever sees string | blocks.

import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import type { Question } from "~/types";

export function normalizeQuestionBodies<T extends Question>(questions: T[]): T[] {
  return questions.map((q) =>
    q.type === "info" && q.data.body != null && typeof q.data.body !== "string"
      ? { ...q, data: { ...q.data, body: ensureBlocks(q.data.body) } }
      : q,
  );
}
