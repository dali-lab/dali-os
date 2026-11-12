import { Link } from "react-router";
import { CalendarDays } from "lucide-react";
import { MonthCalendarPanel } from "~/components/MonthCalendarPanel";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { type LoaderData } from "~/projects/components/detail/types";

export function MeetingsSection({
  meetings,
  calendar,
  projectId,
  standalone = false,
}: {
  meetings: LoaderData["upcomingMeetings"];
  // Present only on the standalone Meetings tab — the loader builds the grid
  // for that tab alone.
  calendar?: LoaderData["projectCalendar"];
  projectId?: string;
  standalone?: boolean;
}) {
  const tz = useUserTimeZone();

  const grid =
    calendar && projectId ? (
      <MonthCalendarPanel
        days={calendar.monthDays}
        events={calendar.events}
        monthOffset={calendar.monthOffset}
        monthLabel={calendar.monthLabel}
        timeZone={calendar.timeZone}
        basePath={`/projects/${projectId}?tab=meetings`}
        sourceLabel={
          calendar.calendarEmail
            ? `${calendar.calendarEmail} · epic and story deadlines`
            : "Project meetings · epic and story deadlines"
        }
      />
    ) : null;

  if (meetings.length === 0) {
    if (!standalone) return null;
    return (
      <div className="flex flex-col gap-4">
        {grid}
        <section className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {calendar && !calendar.calendarEmail
            ? "No meetings scheduled for this project. Set a calendar email in Details to tie this grid to the project's calendar identity."
            : "No meetings scheduled for this project."}
        </section>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {grid}
    <section className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
        <CalendarDays className="w-4 h-4" /> Meetings
      </h2>
      <div className="flex flex-col divide-y divide-border">
        {meetings.map((m) => (
          <Link
            key={m.id}
            to="/calendar"
            className="py-2.5 flex items-center justify-between gap-3 text-sm group"
          >
            <span className="truncate font-medium text-foreground group-hover:text-os-accent">
              {m.title}
            </span>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {formatDateTime(m.startsAt, tz)}
            </span>
          </Link>
        ))}
      </div>
    </section>
    </div>
  );
}

/* One domain's challenge for a term. Folded by default: a project declares up
   to eight domains and their scopes run to paragraphs, so leaving every one of
   them open buried the sections under it. The domain name is the affordance. */
