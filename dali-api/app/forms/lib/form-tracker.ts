// Client-safe half of the response tracker: who counts as expected, and the
// wording and rules around reminding them. The queries live in
// form-tracker.server.ts.

export const ANNOUNCEMENT_SOURCE = "Announcement";
export const REMINDER_COOLDOWN_MS = 24 * 60 * 60_000;
export const REMINDER_MESSAGE_MAX = 1000;

export type TrackerPerson = {
  userId: string;
  /** Group names, plus "Announcement" when a to-do announcement reached them. */
  sources: string[];
  responded: boolean;
  /** Has a to-do for this form and every one of them is marked read, without a response. */
  dismissed: boolean;
};

export type TrackerTodo = { userId: string; readAt: Date | null };

export function buildTrackerPeople(args: {
  groups: { name: string; memberIds: string[] }[];
  todos: TrackerTodo[];
  respondedIds: ReadonlySet<string>;
}): TrackerPerson[] {
  const sources = new Map<string, string[]>();
  const add = (userId: string, source: string) => {
    const list = sources.get(userId) ?? [];
    if (!list.includes(source)) list.push(source);
    sources.set(userId, list);
  };
  for (const g of args.groups) for (const id of g.memberIds) add(id, g.name);

  const openTodo = new Map<string, boolean>();
  for (const t of args.todos) {
    add(t.userId, ANNOUNCEMENT_SOURCE);
    openTodo.set(t.userId, (openTodo.get(t.userId) ?? false) || t.readAt === null);
  }

  return [...sources].map(([userId, userSources]) => {
    const responded = args.respondedIds.has(userId);
    return {
      userId,
      sources: userSources,
      responded,
      dismissed: !responded && openTodo.get(userId) === false,
    };
  });
}

export type TrackerCounts = { expected: number; responded: number };

export function trackerCounts(people: TrackerPerson[]): TrackerCounts | null {
  if (people.length === 0) return null;
  return { expected: people.length, responded: people.filter((p) => p.responded).length };
}

/** People a reminder can reach: not responded, and not having dismissed the to-do. */
export function remindablePeople(people: TrackerPerson[]): TrackerPerson[] {
  return people.filter((p) => !p.responded && !p.dismissed);
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function remindLabel(n: number): string {
  return `Remind ${n} ${plural(n, "person", "people")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function clock(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export type ReminderBlock = "cooldown" | "unpublished" | "dismissed-only";

export function reminderBlock(args: {
  published: boolean;
  lastRemindedAt: Date | null;
  remindable: number;
  now: Date;
}): ReminderBlock | null {
  if (!args.published) return "unpublished";
  if (
    args.lastRemindedAt &&
    args.now.getTime() - args.lastRemindedAt.getTime() < REMINDER_COOLDOWN_MS
  ) {
    return "cooldown";
  }
  if (args.remindable === 0) return "dismissed-only";
  return null;
}

export function reminderBlockMessage(
  block: ReminderBlock,
  lastRemindedAt: Date | null,
  now: Date,
): string {
  if (block === "unpublished") {
    return "This form isn't published, so a reminder would link to nothing.";
  }
  if (block === "dismissed-only") {
    return "Everyone left dismissed the to-do, so there's nobody to remind.";
  }
  if (!lastRemindedAt) return "";
  const when = sameDay(lastRemindedAt, now) ? "today" : "yesterday";
  const next = sameDay(lastRemindedAt, now)
    ? "tomorrow"
    : `today after ${clock(lastRemindedAt)}`;
  return `Last reminder ${when} at ${clock(lastRemindedAt)}. You can send another ${next}.`;
}

export function dismissedNote(dismissed: number): string | null {
  return dismissed === 0
    ? null
    : `${dismissed} dismissed the to-do and won't be reminded.`;
}

export function formatCloseDate(closesAt: Date, timeZone?: string): string {
  return closesAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
}

export function defaultReminderMessage(
  name: string,
  closesAt: Date | null,
  timeZone?: string,
): string {
  const first = `You haven't filled out ${name} yet.`;
  return closesAt ? `${first} It closes ${formatCloseDate(closesAt, timeZone)}.` : first;
}

export function trackerSubtitle(
  notResponded: number,
  expected: number,
  closesAt: Date | null,
  timeZone?: string,
): string {
  const base = `${notResponded} of ${expected} ${plural(expected, "person", "people")}.`;
  return closesAt ? `${base} Closes ${formatCloseDate(closesAt, timeZone)}.` : base;
}
