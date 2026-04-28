import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(nodes).filter(
    el => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Pure helper for tab cycling at the boundaries of a focus trap.
 * Returns the element that should receive focus (caller calls .focus() and
 * preventDefault), or `null` to let the browser handle it normally.
 */
export function nextTrapTarget(
  focusable: HTMLElement[],
  current: Element | null,
  shiftKey: boolean,
): HTMLElement | null {
  if (focusable.length === 0) return null;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (shiftKey && current === first) return last;
  if (!shiftKey && current === last) return first;
  return null;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  /** Element to focus when the modal opens. Defaults to first focusable. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Disable Escape-to-close (e.g. while a request is mid-flight). */
  disableEscape?: boolean;
  className?: string;
  containerClassName?: string;
}

export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  initialFocusRef,
  disableEscape = false,
  className = "fixed inset-0 z-50 flex items-center justify-center bg-black/40",
  containerClassName = "bg-card rounded-2xl shadow-xl max-w-md w-full mx-4 p-6",
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;

    const dialog = dialogRef.current;
    if (dialog) {
      const target = initialFocusRef?.current ?? getFocusable(dialog)[0] ?? dialog;
      target.focus();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      const trigger = triggerRef.current;
      if (trigger && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !disableEscape) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = getFocusable(dialog);
      const next = nextTrapTarget(focusable, document.activeElement, e.shiftKey);
      if (next) {
        e.preventDefault();
        next.focus();
      } else if (focusable.length === 0) {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, disableEscape]);

  if (!open) return null;

  return (
    <div
      className={className}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={e => {
        if (e.target === e.currentTarget && !disableEscape) onClose();
      }}
    >
      <div ref={dialogRef} className={containerClassName} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
