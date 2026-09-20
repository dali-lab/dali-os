import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Tooltip } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

// The cycle Setup tab's card: one surface, a sentence-case title, one line of
// explanation, then the section's fields. Every Setup section wears it so the
// tab reads as one stack (TermDatesCard is the reference).
export function SetupCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Sits at the title row's right edge (a status pill, a Change button). */
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { panel, panelPad, sectionTitle, bodyText } = useOsChrome();
  return (
    <section className={cn(panel, panelPad, "flex flex-col gap-4")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className={sectionTitle}>{title}</h3>
          {description && <p className={bodyText}>{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}

const PILL_TONES = {
  neutral: "bg-os-container text-os-grey",
  accent: "bg-os-accent/15 text-os-accent",
  // Real states that must stand out: something is set, or something is missing.
  success: "bg-os-green/15 text-os-green",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
} as const;

export type PillTone = keyof typeof PILL_TONES;

// A state's colour as a dot instead of a whole tinted chip: rows that carry one
// pill per item (a decision, a reviewer) stay quiet, and the dot does the work.
const DOT_TONES: Record<PillTone, string> = {
  neutral: "bg-os-grey",
  accent: "bg-os-accent",
  success: "bg-os-green",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

export function Pill({
  tone = "neutral",
  dot,
  children,
}: {
  tone?: PillTone;
  /** Colour the state as a leading dot and keep the chip neutral. */
  dot?: PillTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
        PILL_TONES[dot ? "neutral" : tone],
      )}
    >
      {dot && <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT_TONES[dot])} aria-hidden />}
      {children}
    </span>
  );
}

/** A select sitting in a row with h-9 DateFields/buttons (see TermDatesCard):
 *  the trigger's padding is swapped for the row height, since cn() doesn't
 *  merge conflicting utilities. */
export function rowTrigger(formTrigger: string): string {
  return formTrigger.replace("py-2.5", "h-9");
}

/** A page-header select: taller and fully rounded, so it reads as a control
 *  rather than a field (the domain page's cycle picker). */
export function pillTrigger(formTrigger: string): string {
  return formTrigger.replace("py-2.5", "h-10").replace("rounded-[10px]", "rounded-full").replace("px-3.5", "px-4");
}

/** A small amber "!" with its reason in a tooltip (and for screen readers),
 *  for a row that needs attention: a domain that isn't ready, timeline weeks
 *  that don't line up. */
export function AlertIcon({ label }: { label: string }) {
  return (
    <Tooltip content={label}>
      <CircleAlert className="h-4 w-4 shrink-0 text-amber-600" aria-label={label} role="img" />
    </Tooltip>
  );
}
