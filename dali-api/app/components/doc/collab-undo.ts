import type { EditorState } from "prosemirror-state";
import type * as Y from "yjs";

function findCollabUndoManager(state: EditorState): Y.UndoManager | null {
  for (const plugin of state.plugins) {
    const pluginState = plugin.getState(state) as { undoManager?: Y.UndoManager } | undefined;
    if (pluginState && typeof pluginState.undoManager?.undo === "function") {
      return pluginState.undoManager;
    }
  }
  return null;
}

// yUndoPlugin destroys its UndoManager whenever its plugin view is torn down,
// which BlockNote does on every remount and every registerExtension, while the
// EditorState keeps reusing that dead manager. The manager ends with the Y.Doc
// instead (releaseCollabDoc). Duck-typed because the prod bundle can inline
// y-prosemirror's plugin key twice.
function neuterDestroy(state: EditorState): void {
  const um = findCollabUndoManager(state);
  if (um) um.destroy = () => {};
}

// Call before the editor mounts; mount builds the EditorState that owns the manager.
export function keepCollabUndoAlive(editor: { onMount: (callback: () => void) => () => void; prosemirrorState: EditorState }): () => void {
  neuterDestroy(editor.prosemirrorState);
  return editor.onMount(() => neuterDestroy(editor.prosemirrorState));
}
