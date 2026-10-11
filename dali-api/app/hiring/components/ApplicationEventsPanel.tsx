import { formatSessionWhen } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import type { HiringEventKind } from "~/generated/prisma/enums";

const EVENT_KIND_LABELS: Record<HiringEventKind, string> = {
  HelpHour: "Help hour",
  Social: "Social",
  InfoSession: "Info session",
  Other: "Other",
};

export type EventEngagementRow = {
  eventId: string;
  title: string;
  kind: HiringEventKind;
  startsAt: string | Date;
  endsAt: string | Date;
  cycleId: string;
  cycleName: string;
};

export function ApplicationEventsPanel({
  entries,
  currentCycleId,
}: {
  entries: EventEngagementRow[];
  currentCycleId: string;
}) {
  const tz = useUserTimeZone();
  if (entries.length === 0) return null;
  return (
    <section className="bg-card border border-border rounded-lg">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="font-heading font-bold text-foreground">
          Application events attended
        </h2>
      </div>
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <li key={e.eventId} className="px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="accent">{EVENT_KIND_LABELS[e.kind]}</Pill>
              <span className="text-sm font-semibold text-foreground">{e.title}</span>
              <span className="text-xs text-muted-foreground">
                {formatSessionWhen(e.startsAt, e.endsAt, tz)}
              </span>
              {e.cycleId !== currentCycleId && (
                <span className="text-xs text-muted-foreground">Prior cycle: {e.cycleName}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
