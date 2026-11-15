import { useEffect } from "react";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { readTabAcceptsSuggestionPreference } from "~/lib/tab-accepts-suggestion";

type TabEvent = Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing">;

export function acceptsSuggestionOnTab(event: TabEvent, menuOpen: boolean): boolean {
  return (
    menuOpen &&
    event.key === "Tab" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing
  );
}

type EditorLike = {
  domElement?: HTMLElement | null;
  getExtension: (ext: typeof SuggestionMenu) => { shown: () => boolean } | undefined;
};

// BlockNote's / and @ menus only accept on Enter, so an opted-in Tab is replayed
// as that Enter; document capture runs before BlockNote's handler and the indent.
export function useTabAcceptsSuggestion(editor: EditorLike): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = editor.domElement;
      const target = event.target;
      if (!root || !(target instanceof Node) || !root.contains(target)) return;
      if (event.key !== "Tab" || !readTabAcceptsSuggestionPreference()) return;
      if (!acceptsSuggestionOnTab(event, editor.getExtension(SuggestionMenu)?.shown() ?? false)) return;
      event.preventDefault();
      event.stopPropagation();
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }),
      );
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);
}
