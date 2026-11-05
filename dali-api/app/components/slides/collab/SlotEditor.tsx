import type * as Y from "yjs";
import { DocEditor } from "~/components/doc/DocEditor";
import type { DocCommentsConfig } from "~/components/doc/types";
import type { LayoutSlot } from "~/components/slides/deck/layouts";
import { placedStyle } from "~/components/slides/deck/units";
import { textStyleCss, type TextStyleId } from "~/components/slides/deck/themes";
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
}) {
  return (
    <div
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
      />
    </div>
  );
}
