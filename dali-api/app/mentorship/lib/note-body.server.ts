import { pageDocName } from "~/collab/roomName";
import { readDocAsBlocks } from "~/collab/read";
import type { DocBlock } from "~/collab/blocknote-server";

export async function readMentorNoteBlocks(note: { pageId: string | null }): Promise<DocBlock[]> {
  return note.pageId ? readDocAsBlocks(pageDocName(note.pageId)) : [];
}
