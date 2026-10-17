import { formatSessionWhen } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { ApplicantPanel, PANEL_ROW } from "~/hiring/components/ApplicantPanel";
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
  defaultOpen,
}: {
  entries: EventEngagementRow[];
  currentCycleId: string;
  defaultOpen?: boolean;
}) {
  const tz = useUserTimeZone();
  if (entries.length === 0) return null;
  return (
    <ApplicantPanel title="Application events attended" defaultOpen={defaultOpen}>
        {entries.map((e) => (
          <li key={e.eventId} className={PANEL_ROW}>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="accent">{EVENT_KIND_LABELS[e.kind]}</Pill>
              <span className="text-sm font-semibold text-foreground">{e.title}</span>
              <span className="text-xs text-os-grey">
                {formatSessionWhen(e.startsAt, e.endsAt, tz)}
              </span>
              {e.cycleId !== currentCycleId && (
                <span className="text-xs text-os-grey">Prior cycle: {e.cycleName}</span>
              )}
            </div>
          </li>
        ))}
    </ApplicantPanel>
  );
}
