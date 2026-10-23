import { format } from 'date-fns';
import { api } from '../api/client';
import type { Notebook } from '../api/contract';

/** Where a new note is filed: the member's own notes, or one of their notebooks. */
export type NoteDestination = { kind: 'personal' } | { kind: 'notebook'; notebook: Notebook };

export interface CreatedNotePage {
  pageId: string;
  title: string;
  documentName: string;
}

/** Creates an empty note in the destination, named for now (a notebook names its own notes by date). */
export async function createNotePage(destination: NoteDestination, now = new Date()): Promise<CreatedNotePage> {
  if (destination.kind === 'notebook') {
    const { id } = await api.newNotebookNote(destination.notebook.id);
    return { pageId: id, title: `${destination.notebook.title} · ${format(now, 'MMM d')}`, documentName: `doc:${id}:body` };
  }
  const title = `Note · ${format(now, 'MMM d, h:mm a')}`;
  const page = await api.personalNotePage(title);
  return { pageId: page.pageId, title, documentName: page.documentName };
}
