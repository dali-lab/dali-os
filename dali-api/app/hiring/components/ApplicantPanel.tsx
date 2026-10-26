import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "~/lib/cn";

export const PANEL_CARD = "rounded-os-card bg-os-card overflow-hidden";
export const PANEL_HEADER = "px-6 pt-5";
export const PANEL_TITLE = "font-heading text-[17px] font-semibold text-foreground";
export const PANEL_ROW = "rounded-os-item bg-os-well px-4 py-3";

// The card every block on an applicant page wears (the application itself,
// education history, email threads, prior cycles), so they read as one stack.
export function ApplicantPanel({
  title,
  subtitle,
  footer,
  defaultOpen = true,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  footer?: ReactNode;
  /** False starts the panel folded to its title row; the title toggles it. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const heading = (
    <>
      <h2 className={PANEL_TITLE}>{title}</h2>
      {subtitle != null && <p className="mt-1 text-sm text-os-grey">{subtitle}</p>}
    </>
  );
  return (
    <section className={PANEL_CARD}>
      {defaultOpen ? (
        <div className={PANEL_HEADER}>{heading}</div>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            PANEL_HEADER,
            "flex w-full items-start justify-between gap-3 text-left",
            !open && "pb-5",
          )}
        >
          <div className="min-w-0">{heading}</div>
          <ChevronDown
            className={cn("mt-1 h-5 w-5 shrink-0 text-os-grey transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
      )}
      {open && (
        <>
          <ul className="flex flex-col gap-2 px-6 pb-6 pt-4">{children}</ul>
          {footer != null && <p className="-mt-2 px-6 pb-5 text-xs text-os-grey">{footer}</p>}
        </>
      )}
    </section>
  );
}
