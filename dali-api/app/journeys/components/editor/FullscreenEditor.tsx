import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";

/**
 * A full-window workspace over the page: the document, slide, quiz and lab
 * editors, and the learner previews. Escape closes it unless a nested control
 * (a menu, a dialog) handled the key first. Sits under z-50 so the app's
 * confirm dialogs and toasts still open above it.
 */
// Open overlays, oldest first. One Escape closes only the top one: a learner
// preview opens on top of the editor it previews.
const openStack: string[] = [];

export function FullscreenEditor({
  open,
  title,
  subtitle,
  actions,
  doneLabel = "Done",
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  doneLabel?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  // Read through a ref so a new onClose each render doesn't re-push this
  // overlay to the top of the stack.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    openStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || openStack[openStack.length - 1] !== id) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      openStack.splice(openStack.indexOf(id), 1);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, id]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[45] flex flex-col bg-os-bg font-os text-foreground"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-os-container px-3">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onClose} className={buttonClasses("secondary", "sm")}>
            <Check className="h-3.5 w-3.5" aria-hidden />
            {doneLabel}
          </button>
          <span className="h-5 w-px bg-os-container" aria-hidden />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {subtitle && <p className="truncate text-xs text-os-muted">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>,
    document.body,
  );
}
