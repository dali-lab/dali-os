import type * as Y from "yjs";
import { DocEditor } from "~/components/doc/DocEditor";
import type { SlotCollab } from "./SlotEditor";

export function NotesPane({ fragment, collab }: { fragment: Y.XmlFragment; collab: SlotCollab }) {
  return (
    <section aria-label="Speaker notes" className="h-32 shrink-0 overflow-y-auto border-t border-os-container px-3 py-2">
      <h3 className="mb-1 text-xs font-medium text-os-grey">Speaker notes</h3>
      <DocEditor
        features="slide"
        density="compact"
        placeholder="Add notes for this slide"
        collab={{ documentName: collab.room, token: collab.token, userName: collab.user.name, userId: collab.user.userId }}
        fragment={fragment}
        undoExtension={collab.undoExtension}
      />
    </section>
  );
}
