import { useEffect, useRef } from "react";
import type * as Y from "yjs";
import { DocEditor } from "~/components/doc/DocEditor";
import type { DocCommentsConfig } from "~/components/doc/types";
import type { LayoutSlot } from "~/components/slides/deck/layouts";
import { placedStyle } from "~/components/slides/deck/units";
import { textStyleCss, type TextStyleId } from "~/components/slides/deck/themes";
import { neededHeight } from "./auto-height";
import { registerTextEditor } from "./text-format";
import type { DeckUser } from "./useDeckDoc";

export interface SlotCollab {
  room: string;
  token: string;
  user: DeckUser;
  undoExtension: unknown;
}

const FLEX_ALIGN = { top: "flex-start", center: "center", bottom: "flex-end" } as const;

/** One live text box. Mounted only for the slide being edited. */
export function SlotEditor({
  slot,
  style,
  fragment,
  collab,
  selected,
  onFocus,
  onBlur,
  comments,
  elementId,
  rot,
  onEscape,
  grow,
}: {
  slot: LayoutSlot;
  style: TextStyleId;
  fragment: Y.XmlFragment;
  collab: SlotCollab;
  selected: boolean;
  onFocus: () => void;
  onBlur?: () => void;
  comments?: DocCommentsConfig;
  elementId?: string;
  rot?: number;
  onEscape?: () => void;
  /** Free text boxes grow with their text: called with the height in slide units the text needs. */
  grow?: (needed: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const growRef = useRef(grow);
  growRef.current = grow;
  const widthUnits = slot.rect.w;
  const active = Boolean(grow);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const needed = neededHeight(el, widthUnits);
        if (needed !== null) growRef.current?.(needed);
      });
    };
    const mutations = new MutationObserver(measure);
    mutations.observe(el, { childList: true, subtree: true, characterData: true });
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    sizes?.observe(el);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes?.disconnect();
    };
  }, [active, widthUnits]);
  return (
    <div
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented && onEscape) {
          e.stopPropagation();
          onEscape();
        }
      }}
      data-slot={slot.slot}
      data-element-id={elementId ?? slot.slot}
      data-valign={slot.valign}
      data-selected={selected || undefined}
      className="dali-slide-slot"
      onFocusCapture={onFocus}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.();
      }}
      onContextMenu={(e) => e.stopPropagation()}
      style={{
        ...placedStyle({ ...slot.rect, rot }),
        display: "flex",
        flexDirection: "column",
        justifyContent: FLEX_ALIGN[slot.valign],
        textAlign: slot.align,
        overflow: "hidden",
        ...textStyleCss(style),
      }}
    >
      <DocEditor
        features="slide"
        density="compact"
        placeholder={slot.placeholder}
        collab={{ documentName: collab.room, token: collab.token, userName: collab.user.name, userId: collab.user.userId }}
        fragment={fragment}
        undoExtension={collab.undoExtension}
        comments={comments}
        onEditorReady={elementId ? (editor) => registerTextEditor(elementId, editor) : undefined}
      />
    </div>
  );
}
