import { useState } from "react";
import { CalendarDays, Clock3, GraduationCap, X, type LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import { Modal } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { CalendarsPanel } from "~/calendar/components/CalendarsPanel";
import { ClassesManagerBody } from "~/calendar/components/composer";
import { WorkingHoursCard } from "~/calendar/components/settings-cards";
import type { LoaderData } from "~/calendar/lib/types";

// Everything that configures the Calendar page, behind the toolbar's one
// Settings pill. Calendars and Availability used to be two pills opening two
// dialogs; they answer the same question ("how is this page set up for me"),
// so they're sections of one master-detail dialog instead — the shape
// TemplatesModal already uses: rail on the left, the section's real body on
// the right. Availability's two cards split into their own sections, which is
// how they already read (each titles itself).

const TITLE_ID = "calendar-settings-title";

type SectionId = "calendars" | "classes" | "hours";

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; blurb: string }[] = [
  {
    id: "calendars",
    label: "Calendars",
    icon: CalendarDays,
    blurb: "Connected Google accounts, and which calendars the grid draws.",
  },
  {
    id: "classes",
    label: "Classes",
    icon: GraduationCap,
    blurb: "Your classes this term, so nobody books over them.",
  },
  {
    id: "hours",
    label: "Working hours",
    icon: Clock3,
    blurb: "The window you're bookable in, per day.",
  },
];

export function CalendarSettingsModal({
  data,
  hiddenCals,
  toggleHiddenCal,
  onClose,
}: {
  data: LoaderData;
  hiddenCals: Set<string>;
  toggleHiddenCal: (id: string) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<SectionId>("calendars");
  const { panel, cardPad } = useOsChrome();
  const active = SECTIONS.find((s) => s.id === section)!;

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={TITLE_ID}
      // `!p-0` + flex column: the split pane owns its own padding, and the
      // rail has to reach the card's edges to read as a rail.
      containerClassName={modalCardClass(
        "max-w-5xl h-[80vh] max-h-[calc(100vh-3rem)] flex flex-col overflow-hidden !p-0",
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <h2 id={TITLE_ID} className="font-heading text-xl font-medium text-foreground">
          Calendar settings
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="os-icon-btn">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Below sm the rail would eat the body, so the same sections ride the
            shared segmented control at the top of the pane instead. */}
        <nav
          aria-label="Settings sections"
          className="hidden w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2 sm:flex"
        >
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={s.id === section}
                className={cn(
                  "flex w-full items-center gap-2 rounded-os-item px-2.5 py-2 text-left text-sm transition-colors",
                  s.id === section
                    ? "bg-os-container text-foreground"
                    : "text-foreground/80 hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-5 py-5 sm:px-6">
          <SegmentedTabButtons
            className="mb-4 sm:hidden"
            label="Settings section"
            items={SECTIONS.map((s) => ({
              label: s.label,
              icon: s.icon,
              active: s.id === section,
              onClick: () => setSection(s.id),
            }))}
          />

          <header className="mb-4">
            <h3 className="font-heading text-base font-semibold text-foreground">{active.label}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">{active.blurb}</p>
          </header>

          {section === "calendars" && (
            <CalendarsPanel data={data} hiddenCals={hiddenCals} toggleHiddenCal={toggleHiddenCal} />
          )}
          {section === "classes" && (
            <div className={cn(panel, cardPad)}>
              <ClassesManagerBody data={data} />
            </div>
          )}
          {section === "hours" && (
            <WorkingHoursCard
              workingHours={data.workingHours}
              hasPersisted={data.hasPersistedWorkingHours}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
