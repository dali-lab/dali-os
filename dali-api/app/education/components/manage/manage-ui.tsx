import { type ReactNode } from "react";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

export const TABS = [
  { key: "details", label: "Details" },
  { key: "sessions", label: "Sessions" },
  { key: "applications", label: "Applications" },
  { key: "roster", label: "Roster" },
  { key: "materials", label: "Materials" },
  { key: "assignments", label: "Assignments" },
  { key: "announcements", label: "Discussion" },
  { key: "feedback", label: "Feedback" },
] as const;

// Weekday chips for the "Generate a session series" picker. Index === JS
// getDay() (0 = Sunday), so the checkbox value maps straight to the weekday the
// server schedules on.
export const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// A notice the page posts back after an action. One surface, one shape: the
// old green-50 chip was a brand-shell colour that read as a foreign sticker on
// the os page.
export const NOTICE_CLASS =
  "rounded-os-item bg-os-well px-4 py-3 text-sm text-foreground";

// Every block on this page is a titled section: the title and its explanation
// sit on the page ground, and only the thing you operate on is boxed. Stacking
// eight self-titled cards instead made the page read as a column of boxes, with
// each heading trapped inside its own border.
export function ManageSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Pinned to the title's right — a "Manage templates" link, a Save button. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const os = useOsChrome();
  return (
    <section className={os.sectionShell}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className={os.sectionTitle}>{title}</h2>
          {description && (
            <p className={cn(os.bodyText, "mt-1 max-w-2xl")}>{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className={cn(os.panel, os.panelPad)}>{children}</div>
    </section>
  );
}

// A row nested inside one of those panels: an instructor, an email slot, a
// feedback binding. The design sinks them into a well rather than drawing a
// second border inside the card.
export const WELL_ROW_CLASS =
  "flex items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3";

// A stacked field: caption above control. The caption itself wears
// `.os-field-label`, the design's 11px uppercase cap, so this only owns the
// column — and `os-form` on the enclosing form dresses the control.
export const FIELD_COL = "flex flex-col gap-2";


