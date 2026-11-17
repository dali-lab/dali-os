import { formatInTimeZone } from "~/lib/timezone";

export const TERM_WEEKS = 10;

export type TimelineEvent = {
  id: string;
  source: "alumni" | "dali";
  title: string;
  startsAt: string;
  hostName: string | null;
  location: string | null;
  goingCount: number;
  classmates: number;
  viewerGoing: boolean;
  href: string | null;
};

export type TimelineProjects = { count: number; oldProject: string | null };

export type TimelineTerm = {
  index: number;
  term: string;
  startLabel: string;
  projects: TimelineProjects;
};

export type WeekState = "past" | "current" | "future" | "last";

export function weekStates(index: number, total = TERM_WEEKS): WeekState[] {
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    if (n === index) return "current";
    if (n === total) return "last";
    return n < index ? "past" : "future";
  });
}

export function eventMeta(e: TimelineEvent, tz: string): string {
  const day = formatInTimeZone(e.startsAt, tz, { weekday: "short" });
  const time = formatInTimeZone(e.startsAt, tz, { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  const crowd = [
    e.goingCount > 0 ? `${e.goingCount} going` : null,
    e.classmates > 0 ? `${e.classmates} from your class` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    `${day} ${time}`,
    e.hostName ? `Hosted by ${e.hostName}` : e.location,
    crowd || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function projectsLine(p: TimelineProjects): string | null {
  if (p.oldProject) return `${p.oldProject}, your old project, is still running this term.`;
  if (p.count === 0) return null;
  return `${p.count} ${p.count === 1 ? "team is" : "teams are"} building this term.`;
}
