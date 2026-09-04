import { GraduationCap } from "lucide-react";
import { cn } from "~/lib/cn";
import { useOsChrome } from "~/components/os-chrome";
import { WorkingHoursCard } from "~/calendar/components/settings-cards";
import { ClassesManagerBody } from "~/calendar/components/composer";
import type { LoaderData } from "~/calendar/lib/types";

// The Availability tab: everything that decides when other people can book you.
// One full-width column, in the order a student uses it — classes first, then
// the optional working-hours window.

/** A section header: glyph, title, and at most one line of context. Anything
 *  longer belongs in the control itself, not above it. */
function SectionHeader({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export function AvailabilityView({ data }: { data: LoaderData }) {
  // WorkingHoursCard brings its own surface, so the classes card takes the same
  // `panel` + `cardPad` pair — otherwise the two sections sit on differently
  // padded grounds and their contents stop lining up.
  const { panel, cardPad } = useOsChrome();
  const card = cn(panel, cardPad);

  return (
    <div className="flex w-full flex-col gap-7">
      <section>
        <SectionHeader icon={GraduationCap} title="Classes this term" />
        <div className={card}>
          <ClassesManagerBody data={data} />
        </div>
      </section>

      {/* No SectionHeader here — the card titles itself with the same glyph, so
          a second heading above it just said "Working hours" twice. */}
      <section>
        <WorkingHoursCard
          workingHours={data.workingHours}
          hasPersisted={data.hasPersistedWorkingHours}
        />
      </section>
    </div>
  );
}
