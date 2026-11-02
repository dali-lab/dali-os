import { autoUpdate, flip, FloatingList, FloatingPortal, offset, shift, useFloating } from "@floating-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu, MenuContext } from "~/components/ui/floating/Menu";
import { usePanelClass } from "~/components/ui/floating/os-styles";
import {
  applyPasteEmbed,
  offerIsCurrent,
  PASTE_OFFER_EVENT,
  type PasteEmbedType,
  type PasteOffer,
} from "./paste-embed";
import type { DocEditorInstance } from "./schema/build";

const MODIFIER_KEYS = new Set(["Shift", "Meta", "Control", "Alt"]);

interface PasteOption {
  label: string;
  embed: PasteEmbedType | null;
}

function pasteOptions(editor: DocEditorInstance): PasteOption[] {
  return [
    { label: "Embed video", embed: "video" },
    ...("embed" in editor.schema.blockSchema ? [{ label: "Bookmark", embed: "embed" as const }] : []),
    { label: "URL", embed: null },
  ];
}

// Focus stays in the editor so typing carries straight on, which rules out
// useListNavigation and FloatingFocusManager: both move focus into the menu.
export function PasteAsMenu({ editor }: { editor: DocEditorInstance }) {
  const panelClass = usePanelClass();
  const [offer, setOffer] = useState<PasteOffer | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);
  const options = useMemo(() => pasteOptions(editor), [editor]);

  const close = useCallback(() => setOffer(null), []);
  const choose = useCallback(
    (option: PasteOption) => {
      if (offer && option.embed) applyPasteEmbed(editor, offer, option.embed);
      close();
    },
    [editor, offer, close],
  );

  const { refs, floatingStyles } = useFloating({
    open: offer !== null,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  useEffect(() => {
    const dom = editor.domElement;
    if (!dom) return;
    const onOffer = (event: Event) => {
      const view = editor.prosemirrorView;
      refs.setPositionReference({
        contextElement: dom,
        getBoundingClientRect() {
          const { left, top, bottom } = view.coordsAtPos(view.state.selection.head);
          return { x: left, y: top, left, right: left, top, bottom, width: 0, height: bottom - top };
        },
      });
      setActiveIndex(0);
      setOffer((event as CustomEvent<PasteOffer>).detail);
    };
    dom.addEventListener(PASTE_OFFER_EVENT, onOffer);
    return () => dom.removeEventListener(PASTE_OFFER_EVENT, onOffer);
  }, [editor, refs]);

  useEffect(() => {
    if (!offer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(event.key)) return;
      const handled = ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (event.key === "ArrowDown") setActiveIndex((i) => (i + 1) % options.length);
      else if (event.key === "ArrowUp") setActiveIndex((i) => (i - 1 + options.length) % options.length);
      else if (event.key === "Enter") choose(options[activeIndex]!);
      else close();
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onMouseDown);
    const stopSelection = editor.onSelectionChange(close);
    const stopChange = editor.onChange(() => {
      if (!offerIsCurrent(editor, offer)) close();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown);
      stopSelection();
      stopChange();
    };
  }, [editor, offer, options, activeIndex, choose, close]);

  const menuValue = useMemo(
    () => ({ activeIndex, getItemProps: (props: Record<string, unknown> = {}) => props, close }),
    [activeIndex, close],
  );

  if (!offer) return null;
  return (
    <FloatingPortal>
      <div
        ref={(node) => {
          panelRef.current = node;
          refs.setFloating(node);
        }}
        role="menu"
        aria-label="Paste as"
        style={floatingStyles}
        className={`${panelClass} w-[200px]`}
        // Keeps the caret, and so the focus, in the editor on a row click.
        onMouseDown={(event) => event.preventDefault()}
      >
        <div className="px-3 py-1 text-xs font-semibold text-muted-foreground">Paste as</div>
        <MenuContext.Provider value={menuValue}>
          <FloatingList elementsRef={listRef}>
            {options.map((option) => (
              <Menu.Item key={option.label} onSelect={() => choose(option)}>
                {option.label}
              </Menu.Item>
            ))}
          </FloatingList>
        </MenuContext.Provider>
      </div>
    </FloatingPortal>
  );
}
