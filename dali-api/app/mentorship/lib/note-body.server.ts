import { pageDocName } from "~/collab/roomName";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { readDocAsBlocks } from "~/collab/read";
import type { DocBlock } from "~/collab/blocknote-server";

/** The note's body as blocks: its page's room once migrated, `contentJson` before. */
export async function readMentorNoteBlocks(note: {
  pageId: string | null;
  contentJson: unknown;
}): Promise<DocBlock[]> {
  return note.pageId ? readDocAsBlocks(pageDocName(note.pageId)) : ensureBlocks(note.contentJson);
}
