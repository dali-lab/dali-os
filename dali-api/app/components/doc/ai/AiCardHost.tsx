// AiCardHost — Notion-style inline card host for AiPanel.
//
// Renders AiPanel inside a BlockPopover anchored below the block that triggered
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
//   - Escape while card is open: close immediately (abort in-flight request via
//     AiPanel's unmount useEffect that calls abortRef.current?.abort()).
//   - Click outside card: if no result yet → close immediately (abort).
//                         If result showing → confirm("Discard AI response?").
//   - Apply / Insert below / Discard buttons: close as usual (via onClose prop).
//   - Clicks INSIDE the card (including portaled children) are never treated as
//     outside — guarded via card div contains() and the portalElement contains().

import { offset } from "@floating-ui/react";
import { useCallback, useEffect, useRef } from "react";
import { BlockPopover } from "@blocknote/react";
import { AiPanel } from "./AiPanel";
import type { AiPanelProps } from "./AiPanel";
import type { DialogApi } from "~/components/ui/dialog";

interface AiCardHostProps extends AiPanelProps {
  /** The block id to anchor to (already resolved by the caller). */
  anchorBlockId: string;
  /** dialog.confirm accessor — threaded from DocView which has DialogProvider. */
  dialog: DialogApi;
  /** Portal target: the .dali-doc-floating-root div (inside .dali-doc wrapper).
   *  Passed to BlockPopover so the floating card portals into the editor subtree
   *  (same fix as FloatingComposerController/FloatingThreadController). */
  portalElement: HTMLElement | null;
}

export function AiCardHost({
  anchorBlockId,
  dialog,
  portalElement,
  onClose,
  ...panelProps
}: AiCardHostProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Track whether AiPanel has a result via a ref so the mousedown handler always
  // reads the latest value without being re-attached on every state change.
  const hasResultRef = useRef(false);
  const handleHasResultChange = useCallback((v: boolean) => {
    hasResultRef.current = v;
  }, []);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Escape: close immediately (AiPanel unmount cleanup aborts any in-flight fetch).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [handleClose]);

  // Outside-click dismissal via mousedown (captures before focus moves).
  useEffect(() => {
    const onMouseDown = async (e: MouseEvent) => {
      const card = cardRef.current;
      if (!card) return;

      const target = e.target as Node | null;

      // Clicks inside the card div itself — pass through.
      if (card.contains(target)) return;

      // Clicks inside the portal root — could be the card's portaled preview
      // editor (read-only DocEditor which portals into floatingRootRef via its
      // own BlockNote instance) or inline suggestion menus. Pass through.
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
        if (confirmed) handleClose();
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
      // Disable focus trap — conflicts with the read-only DocEditor preview
      // inside the card, and the card manages focus naturally.
      focusManagerProps={{ disabled: true }}
      elementProps={{ style: { zIndex: 50 } }}
    >
      {/* Card chrome */}
      <div
        ref={cardRef}
        className="bg-card border border-border rounded-lg shadow-brand-2 w-[min(600px,90vw)] p-4"
      >
        <AiPanel
          {...panelProps}
          onClose={handleClose}
          previewMaxHeight="35vh"
          onHasResultChange={handleHasResultChange}
        />
      </div>
    </BlockPopover>
  );
}
