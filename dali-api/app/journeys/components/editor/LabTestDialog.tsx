import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Lab } from "~/journeys/lib/types";
import { LabIDE } from "~/journeys/components/lab/LabIDE";

/** "Try as a learner": the lab exactly as learners get it. Nothing typed here is saved. */
export function LabTestDialog({ open, lab, onClose }: { open: boolean; lab: Lab; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // On document, which hears the key before the lab editor's window listener;
    // marking it handled keeps that editor open underneath. A key from outside
    // (a confirm dialog opened on top) belongs to that dialog.
    const onKey = (e: KeyboardEvent) => {
      const inside = e.target instanceof Node && ref.current?.contains(e.target);
      if (e.key === "Escape" && !e.defaultPrevented && (inside || e.target === document.body)) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`Testing ${lab.title}`} className="fixed inset-0 z-[46] bg-os-bg font-os">
      <LabIDE
        lab={lab}
        title={`Testing: ${lab.title || "Untitled lab"}`}
        subtitle="This is what learners see. Edits here aren't saved."
        isCompleted={false}
        onComplete={onClose}
        completeLabel="All checks pass, close"
        onExit={onClose}
        exitLabel="Close test"
      />
    </div>,
    document.body,
  );
}
