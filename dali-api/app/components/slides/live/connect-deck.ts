import { acquireCollabDoc, releaseCollabDoc } from "~/components/doc/collab-doc";
import { slidesRoomName } from "~/collab/roomName";
import { createDeckStore } from "~/components/slides/deck/deck-store";
import { notesTextBySlide } from "~/components/slides/deck/notes-text";
import type { PresentDeck } from "./deck-source";

/** Watches the deck's room without editing it. Returns a function that disconnects. */
export function connectDeck(pageId: string, token: string, onDeck: (deck: PresentDeck) => void): () => void {
  const room = slidesRoomName(pageId);
  const entry = acquireCollabDoc(room, token);
  const store = createDeckStore(entry.ydoc);
  const push = () => {
    const snap = store.getSnapshot();
    if (snap.slides.length > 0) onDeck({ themeId: snap.themeId, slides: snap.slides, notes: notesTextBySlide(entry.ydoc) });
  };
  const unsubscribe = store.subscribe(push);
  push();
  return () => {
    unsubscribe();
    store.destroy();
    releaseCollabDoc(room);
  };
}
