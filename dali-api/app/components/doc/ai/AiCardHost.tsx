// AiCardHost — Notion-style inline card host for AiBar.
//
// Renders AiBar inside a BlockPopover anchored below the block that triggered
// the AI session (slash origin → cursorBlockId; toolbar origin → last selected
// block id). Must be mounted INSIDE BlockNoteView children so useBlockNoteEditor
// is in scope (required by BlockPopover).
//
// Fallback: when the anchor block id is undefined, BlockPopover renders nothing
// (blockId undefined → GenericPopover reference is undefined → not isMounted →
// returns false). The caller (DocView) handles the undefined-blockId fallback by
// rendering the original Modal host instead.
//
// Dismissal contract:
//   - Escape: AiBar owns this internally via useImperativeHandle. AiCardHost
//     delegates to aiBarRef.current.handleEscape().
//   - Click outside card: if no result yet → close immediately.
//                         If result showing → confirm("Discard AI response?").
//   - Accept / Revert buttons inside AiBar: close as usual (via onClose prop).
//   - Clicks INSIDE the card (including portaled children) are never treated as
//     outside — guarded via card div contains() and the portalElement contains().

import { offset } from "@floating-ui/react";
import { useCallback, useEffect, useRef } from "react";
import { BlockPopover } from "@blocknote/react";
import { AiBar } from "./AiBar";
import type { AiBarProps } from "./AiBar";
import type { DialogApi } from "~/components/ui/dialog";
import type { AiBarHandle } from "./AiBar";

interface AiCardHostProps extends AiBarProps {
  /** The block id to anchor to (already resolved by the caller). */
  anchorBlockId: string;
  /** dialog.confirm accessor — threaded from DocView which has DialogProvider. */
  dialog: DialogApi;
  /** Portal target: the .dali-doc-floating-root div (inside .dali-doc wrapper).
   *  Passed to BlockPopover so the floating card portals into the editor subtree
   *  (same fix as FloatingComposerController/FloatingThreadController). */
  portalElement: HTMLElement | null;
  /** Called when the AI writes into a new block — updates the anchor position. */
  onAnchorChange?: (blockId: string) => void;
}

export function AiCardHost({
  anchorBlockId,
  dialog,
  portalElement,
  onClose,
  onAnchorChange,
  ...barProps
}: AiCardHostProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const aiBarRef = useRef<AiBarHandle | null>(null);

  // Track whether AiBar has a result via a ref so the mousedown handler always
  // reads the latest value without being re-attached on every state change.
  const hasResultRef = useRef(false);
  const handleHasResultChange = useCallback((v: boolean) => {
    hasResultRef.current = v;
  }, []);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Escape: delegate to AiBar's imperative handle which owns all phase logic.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        void aiBarRef.current?.handleEscape();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Outside-click dismissal via mousedown (captures before focus moves).
  useEffect(() => {
    const onMouseDown = async (e: MouseEvent) => {
      const card = cardRef.current;
      if (!card) return;

      const target = e.target as Node | null;

      // Clicks inside the card div itself — pass through.
      if (card.contains(target)) return;

      // Clicks inside the portal root — could be portaled content. Pass through.
      if (portalElement && portalElement.contains(target)) return;

      // Actual outside click.
      if (!hasResultRef.current) {
        handleClose();
      } else {
        const confirmed = await dialog.confirm({
          title: "Discard AI response?",
          confirmLabel: "Discard",
          cancelLabel: "Keep open",
        });
        if (confirmed) {
          await aiBarRef.current?.revertAndClose();
        }
      }
    };

    document.addEventListener("mousedown", onMouseDown, true);
    return () => document.removeEventListener("mousedown", onMouseDown, true);
  }, [dialog, handleClose, portalElement]);

  return (
    <BlockPopover
      blockId={anchorBlockId}
      portalElement={portalElement}
      useFloatingOptions={{
        open: true,
        placement: "bottom-start",
        // 8px gap between the anchor block's bottom edge and the card top.
        middleware: [offset(8)],
      }}
      // Disable BlockNote's built-in dismiss so our mousedown handler is the
      // sole outside-click path (we need the hasResult confirm gate).
      useDismissProps={{ enabled: false }}
      // Disable focus trap — AiBar manages focus naturally via autoFocus on input.
      focusManagerProps={{ disabled: true }}
      elementProps={{ style: { zIndex: 50 } }}
    >
      {/* Sizing wrapper only — AiBar's individual cards provide their own chrome. */}
      <div
        ref={cardRef}
        className="w-[min(680px,90vw)] py-2 px-2"
      >
        <AiBar
          ref={aiBarRef}
          {...barProps}
          onClose={handleClose}
          dialog={dialog}
          onHasResultChange={handleHasResultChange}
          onAnchorChange={onAnchorChange}
        />
      </div>
    </BlockPopover>
  );
}
