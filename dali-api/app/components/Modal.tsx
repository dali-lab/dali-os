import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "~/lib/cn";
import { modalCardClass } from "~/components/os-chrome";
import { useFeatureFlag } from "~/components/FeatureFlags";

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
  /** Overrides the dialog card entirely. Omit to take the shell's own. */
  containerClassName?: string;
}

export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  initialFocusRef,
  disableEscape = false,
  className = "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-6 overflow-y-auto",
  containerClassName,
}: ModalProps) {
  const os = useFeatureFlag("os-redesign");
  const container = containerClassName ?? modalCardClass(os, "max-w-md");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;

    const dialog = dialogRef.current;
    if (dialog) {
      const target = initialFocusRef?.current ?? getFocusable(dialog)[0] ?? dialog;
      // preventScroll: focusing the dialog must not scroll the page/board
      // behind the overlay into view (the trigger — e.g. a task card — can be
      // far down a long board, which otherwise jumps it to the top on open).
      target.focus({ preventScroll: true });
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
      className={cn(className, "os-modal-overlay")}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={e => {
        if (e.target === e.currentTarget && !disableEscape) onClose();
      }}
    >
      <div ref={dialogRef} className={container} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

export interface ModalHeaderProps {
  /** Must equal the `labelledBy` id passed to <Modal>. */
  titleId: string;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** Accessible name for the close button. */
  closeLabel?: string;
  /** Hide the standardized close button (rare; e.g. blocking flows). */
  hideClose?: boolean;
  /** Extra controls rendered immediately before the close button (e.g. Edit / Save). */
  actions?: ReactNode;
  className?: string;
}

export function ModalHeader({
  titleId,
  title,
  subtitle,
  onClose,
  closeLabel = "Close",
  hideClose = false,
  actions,
  className = "",
}: ModalHeaderProps) {
  const os = useFeatureFlag("os-redesign");
  return (
    <div className={cn("flex items-start justify-between gap-4", os ? "mb-6" : "mb-4", className)}>
      <div className="min-w-0">
        <h2
          id={titleId}
          className={cn(
            "font-heading text-foreground",
            os ? "text-xl font-medium" : "text-lg font-bold",
          )}
        >
          {title}
        </h2>
        {subtitle && (
          <p className={cn("text-muted-foreground", os ? "mt-1 text-sm" : "mt-0.5 text-xs")}>
            {subtitle}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {actions}
        {!hideClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className={
              os
                ? "os-icon-btn"
                : "text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
            }
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

export interface ModalFooterProps {
  onCancel: () => void;
  cancelLabel?: string;
  /** Primary action button(s). Rendered right-most. */
  children: ReactNode;
  className?: string;
}

export function ModalFooter({
  onCancel,
  cancelLabel = "Cancel",
  children,
  className = "",
}: ModalFooterProps) {
  const os = useFeatureFlag("os-redesign");
  return (
    <div className={cn("mt-6 flex items-center justify-end gap-2", className)}>
      <button
        type="button"
        onClick={onCancel}
        className={
          os ? "os-btn-ghost" : "px-3 py-1.5 text-sm rounded-lg text-foreground/80 hover:bg-muted"
        }
      >
        {cancelLabel}
      </button>
      {children}
    </div>
  );
}
