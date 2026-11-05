import type * as Y from "yjs";
import { DocEditor } from "~/components/doc/DocEditor";
import type { LayoutSlot } from "~/components/slides/deck/layouts";
import { rectStyle, u } from "~/components/slides/deck/units";
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
}: {
  slot: LayoutSlot;
  style: TextStyleId;
  fragment: Y.XmlFragment;
  collab: SlotCollab;
  selected: boolean;
  onFocus: () => void;
}) {
  return (
    <div
      data-slot={slot.slot}
      data-valign={slot.valign}
      className="dali-slide-slot"
      onFocusCapture={onFocus}
      style={{
        ...rectStyle(slot.rect),
        display: "flex",
        flexDirection: "column",
        justifyContent: FLEX_ALIGN[slot.valign],
        textAlign: slot.align,
        overflow: "hidden",
        outline: selected ? `${u(4)} solid var(--slide-accent)` : "none",
        outlineOffset: u(8),
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
      />
    </div>
  );
}
