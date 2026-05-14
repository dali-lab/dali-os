import { Link, redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Calendar as CalendarIcon,
  Clock,
  Shield,
  CalendarDays,
  Building2,
  Wifi,
  Copy,
  UsersRound,
  X,
  RefreshCw,
} from "lucide-react";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { computeFreeIntervals, type Interval } from "~/lib/availability";
import { CalendarActionSchema } from "~/lib/calendar-schemas";
import { fetchBusyEvents, listCalendarsForLink } from "~/lib/google-calendar";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";
import type { Route } from "./+types/calendar";

const DEFAULT_TIMEZONE = "America/New_York";
const DEFAULT_BUFFER_MIN = 15;
const DEFAULT_WORK_START_MIN = 9 * 60;
const DEFAULT_WORK_END_MIN = 17 * 60;

type WhSegment = {
  id: string;
  startMinute: number;
  endMinute: number;
  location: "InPerson" | "Remote";
};

type WhDay = {
  dayOfWeek: number;
  segments: WhSegment[];
};

type ManualBlockDTO = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  recurrenceRule: string | null;
};

type SubCalendarDTO = {
  id: string;
  summary: string;
  primary: boolean;
  color: string | null;
  enabled: boolean;
};

type CalendarLinkDTO = {
  id: string;
  provider: "Google" | "Outlook";
  externalEmail: string;
  displayName: string | null;
  enabled: boolean;
  primary: boolean;
  syncError: string | null;
  // null when the upstream list call failed; the UI shows a degraded card.
  subCalendars: SubCalendarDTO[] | null;
};

type GroupOption = {
  id: string;
  name: string;
  staticMemberIds: string[];
};

type UserOption = {
  id: string;
  firstName: string;
  lastName: string;
  daliEmail: string | null;
};

type LoaderData = {
  timezone: string;
  defaultEventBufferMin: number;
  workingHours: WhDay[];
  manualBlocks: ManualBlockDTO[];
  calendarLinks: CalendarLinkDTO[];
  weekStartIso: string;
  weekEndIso: string;
  busyIntervals: { startIso: string; endIso: string }[];
  ingestionError: string | null;
  groups: GroupOption[];
  users: UserOption[];
  currentUserId: string;
};

function defaultWorkingHours(): WhDay[] {
  // Mon–Fri 9–5 InPerson, weekends disabled. The "default" segment lives only in
  // memory (no id) until the user persists it via the action handler.
  return Array.from({ length: 7 }).map((_, dow) => ({
    dayOfWeek: dow,
    segments:
      dow >= 1 && dow <= 5
        ? [
            {
              id: `default-${dow}`,
              startMinute: DEFAULT_WORK_START_MIN,
              endMinute: DEFAULT_WORK_END_MIN,
              location: "InPerson" as const,
            },
          ]
        : [],
  }));
}

// Window for the visible week grid. We compute Sunday→following Sunday in the
// user's timezone (the grid renders Sun..Sat columns). When `anchor` is provided
// it picks the Sunday of that date's week; otherwise it uses "now".
function weekWindow(timezone: string, anchor?: Date): { start: Date; end: Date } {
  const ref = anchor ?? new Date();
  const ymd = getZonedYMD(ref, timezone);
  const refUtcMidnight = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  const dow = refUtcMidnight.getUTCDay();
  const sundayUtc = new Date(refUtcMidnight.getTime() - dow * 86_400_000);
  const start = zonedDayStartUtc(
    sundayUtc.getUTCFullYear(),
    sundayUtc.getUTCMonth() + 1,
    sundayUtc.getUTCDate(),
    timezone,
  );
  const nextSundayUtc = new Date(sundayUtc.getTime() + 7 * 86_400_000);
  const end = zonedDayStartUtc(
    nextSundayUtc.getUTCFullYear(),
    nextSundayUtc.getUTCMonth() + 1,
    nextSundayUtc.getUTCDate(),
    timezone,
  );
  return { start, end };
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const userId = auth.user.sub;

  const [settings, whRows, blocks, links, groups, users] = await Promise.all([
    prisma.userAvailabilitySettings.findUnique({ where: { userId } }),
    prisma.workingHoursDay.findMany({ where: { userId } }),
    prisma.manualBlock.findMany({
      where: { userId },
      orderBy: { startTime: "asc" },
      take: 200,
    }),
    prisma.userCalendarLink.findMany({
      where: { userId },
      orderBy: { linkedAt: "asc" },
    }),
    prisma.groupDefinition.findMany({
      select: { id: true, name: true, staticMemberIds: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);

  const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
  const bufferMin = settings?.defaultEventBufferMin ?? DEFAULT_BUFFER_MIN;

  // Group persisted rows by day-of-week (multiple segments allowed per day).
  // Skip rows with enabled=false or invalid bounds; the UI treats them as deleted.
  const byDow = new Map<number, WhSegment[]>();
  for (const r of whRows) {
    if (!r.enabled || r.startMinute >= r.endMinute) continue;
    const list = byDow.get(r.dayOfWeek);
    const seg: WhSegment = {
      id: r.id,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      location: r.location,
    };
    if (list) list.push(seg);
    else byDow.set(r.dayOfWeek, [seg]);
  }
  // Defaults only apply for users who have never persisted working hours. Once
  // a user has any WorkingHoursDay row (even disabled / mid-edit), we trust the
  // persisted state — so an explicit "disable Monday" sticks instead of being
  // overwritten by the Mon–Fri 9–5 default on every reload.
  const hasAnyPersisted = whRows.length > 0;
  const workingHours: WhDay[] = defaultWorkingHours().map((d) => {
    const persisted = byDow.get(d.dayOfWeek);
    if (persisted && persisted.length > 0) {
      persisted.sort((a, b) => a.startMinute - b.startMinute);
      return { dayOfWeek: d.dayOfWeek, segments: persisted };
    }
    if (hasAnyPersisted) return { dayOfWeek: d.dayOfWeek, segments: [] };
    return d;
  });

  // Optional ?weekStart=YYYY-MM-DD URL param lets the user navigate weeks.
  // We use it as an anchor inside weekWindow(), which still snaps to that
  // date's Sunday — so any in-week date works. The anchor is built at noon
  // UTC of the requested calendar date so getZonedYMD resolves to the intended
  // local Y/M/D in any of the timezones we support (i.e. not split across
  // midnight on either side).
  const url = new URL(request.url);
  const weekStartParam = url.searchParams.get("weekStart");
  let anchor: Date | undefined;
  if (weekStartParam) {
    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStartParam);
    if (ymdMatch) {
      const y = Number(ymdMatch[1]);
      const m = Number(ymdMatch[2]);
      const d = Number(ymdMatch[3]);
      anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    } else {
      const parsed = new Date(weekStartParam);
      if (!isNaN(parsed.getTime())) anchor = parsed;
    }
  }
  const { start: weekStart, end: weekEnd } = weekWindow(timezone, anchor);

  // Fetch external busy + sub-calendar lists in parallel. Don't fail the page
  // if a single link errors — surface the error on the link card.
  let ingestionError: string | null = null;
  const [externalBusyRaw, calendarLinks] = await Promise.all([
    fetchBusyEvents(userId, weekStart, weekEnd).catch((err) => {
      ingestionError = err instanceof Error ? err.message : "Failed to fetch external busy";
      return [] as { start: string; end: string }[];
    }),
    Promise.all(
      links.map(async (l): Promise<CalendarLinkDTO> => {
        const base = {
          id: l.id,
          provider: l.provider,
          externalEmail: l.externalEmail,
          displayName: l.displayName,
          enabled: l.enabled,
          primary: l.primary,
          syncError: l.syncError,
        };
        if (l.provider !== "Google") {
          return { ...base, subCalendars: null };
        }
        try {
          const items = await listCalendarsForLink(l.id);
          const enabledSet = new Set(l.subCalendarIds);
          // When subCalendarIds is empty, treat the primary as the only one in use.
          const subCalendars: SubCalendarDTO[] = items.map((it) => ({
            id: it.id,
            summary: it.summary,
            primary: it.primary === true,
            color: it.backgroundColor ?? null,
            enabled:
              l.subCalendarIds.length === 0 ? it.primary === true : enabledSet.has(it.id),
          }));
          return { ...base, subCalendars };
        } catch {
          return { ...base, subCalendars: null };
        }
      }),
    ),
  ]);

  const externalBusy: Interval[] = externalBusyRaw.map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));

  // computeFreeIntervals takes a flat list of (dayOfWeek, start, end) entries —
  // expand each day's segments into its own entry.
  const workingHoursFlat = workingHours.flatMap((d) =>
    d.segments.map((s) => ({
      dayOfWeek: d.dayOfWeek,
      enabled: true,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
    })),
  );

  const { busy } = computeFreeIntervals({
    windowStart: weekStart,
    windowEnd: weekEnd,
    workingHours: workingHoursFlat,
    manualBlocks: blocks.map((b) => ({
      startTime: b.startTime,
      endTime: b.endTime,
      recurrenceRule: b.recurrenceRule,
    })),
    externalBusy,
    bufferMin,
    timezone,
  });

  const data: LoaderData = {
    timezone,
    defaultEventBufferMin: bufferMin,
    workingHours,
    manualBlocks: blocks.map((b) => ({
      id: b.id,
      title: b.title,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      recurrenceRule: b.recurrenceRule,
    })),
    calendarLinks,
    weekStartIso: weekStart.toISOString(),
    weekEndIso: weekEnd.toISOString(),
    busyIntervals: busy.map((i: Interval) => ({
      startIso: i.start.toISOString(),
      endIso: i.end.toISOString(),
    })),
    ingestionError,
    groups,
    users,
    currentUserId: userId,
  };
  return data;
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.type === "applicant")
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const userId = auth.user.sub;
  const form = await request.formData();
  const raw = Object.fromEntries(form.entries());

  // Coerce string-encoded fields into the shape Zod expects.
  const candidate = coerceFormToAction(raw);
  const parsed = CalendarActionSchema.safeParse(candidate);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  switch (input.intent) {
    case "set-working-segments": {
      // Validate each segment's bounds and clamp.
      for (const s of input.segments) {
        if (s.startMinute >= s.endMinute) {
          return Response.json({ error: "startMinute must be < endMinute" }, { status: 400 });
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.workingHoursDay.deleteMany({
          where: { userId, dayOfWeek: input.dayOfWeek },
        });
        if (input.segments.length > 0) {
          await tx.workingHoursDay.createMany({
            data: input.segments.map((s) => ({
              userId,
              dayOfWeek: input.dayOfWeek,
              enabled: true,
              startMinute: s.startMinute,
              endMinute: s.endMinute,
              location: s.location,
            })),
          });
        } else {
          // Sentinel row that records "user explicitly cleared this day."
          // The loader skips disabled rows for availability calc but uses their
          // existence to distinguish "explicit empty" from "never set."
          await tx.workingHoursDay.create({
            data: {
              userId,
              dayOfWeek: input.dayOfWeek,
              enabled: false,
              startMinute: 0,
              endMinute: 1,
              location: "InPerson",
            },
          });
        }
      });
      return null;
    }

    case "copy-weekdays": {
      // Copy all of Monday's segments to Tue–Fri.
      const mondaySegments = await prisma.workingHoursDay.findMany({
        where: { userId, dayOfWeek: 1, enabled: true },
        select: { startMinute: true, endMinute: true, location: true, enabled: true },
      });
      if (mondaySegments.length === 0) return null;
      const tuesToFri = [2, 3, 4, 5];
      await prisma.$transaction(async (tx) => {
        await tx.workingHoursDay.deleteMany({
          where: { userId, dayOfWeek: { in: tuesToFri } },
        });
        await tx.workingHoursDay.createMany({
          data: tuesToFri.flatMap((dow) =>
            mondaySegments.map((s) => ({
              userId,
              dayOfWeek: dow,
              enabled: s.enabled,
              startMinute: s.startMinute,
              endMinute: s.endMinute,
              location: s.location,
            })),
          ),
        });
      });
      return null;
    }

    case "reset-working-hours": {
      await prisma.workingHoursDay.deleteMany({ where: { userId } });
      return null;
    }

    case "set-event-buffer": {
      await prisma.userAvailabilitySettings.upsert({
        where: { userId },
        create: { userId, defaultEventBufferMin: input.defaultEventBufferMin },
        update: { defaultEventBufferMin: input.defaultEventBufferMin },
      });
      return null;
    }

    case "add-manual-block": {
      const startTime = new Date(input.startTime);
      const endTime = new Date(input.endTime);
      if (endTime <= startTime) {
        return Response.json({ error: "endTime must be after startTime" }, { status: 400 });
      }
      await prisma.manualBlock.create({
        data: {
          userId,
          title: input.title,
          startTime,
          endTime,
          allDay: input.allDay,
          recurrenceRule: input.recurrenceRule ?? null,
        },
      });
      return null;
    }

    case "update-manual-block": {
      const existing = await prisma.manualBlock.findUnique({ where: { id: input.id } });
      if (!existing || existing.userId !== userId) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      const startTime = input.startTime ? new Date(input.startTime) : existing.startTime;
      const endTime = input.endTime ? new Date(input.endTime) : existing.endTime;
      if (endTime <= startTime) {
        return Response.json({ error: "endTime must be after startTime" }, { status: 400 });
      }
      await prisma.manualBlock.update({
        where: { id: input.id },
        data: {
          title: input.title ?? existing.title,
          startTime,
          endTime,
          allDay: input.allDay ?? existing.allDay,
          recurrenceRule:
            input.recurrenceRule === undefined ? existing.recurrenceRule : input.recurrenceRule,
        },
      });
      return null;
    }

    case "remove-manual-block": {
      const existing = await prisma.manualBlock.findUnique({ where: { id: input.id } });
      if (!existing || existing.userId !== userId) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      await prisma.manualBlock.delete({ where: { id: input.id } });
      return null;
    }

    case "remove-calendar-link": {
      const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
      if (!link || link.userId !== userId) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      await prisma.userCalendarLink.delete({ where: { id: input.linkId } });
      return null;
    }

    case "toggle-sub-calendar": {
      const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
      if (!link || link.userId !== userId) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      const current = new Set(link.subCalendarIds);
      if (input.enabled) current.add(input.calendarId);
      else current.delete(input.calendarId);
      await prisma.userCalendarLink.update({
        where: { id: input.linkId },
        data: { subCalendarIds: Array.from(current) },
      });
      return null;
    }
  }
}

// FormData arrives as strings; convert to the typed shapes Zod expects.
function coerceFormToAction(raw: Record<string, FormDataEntryValue>): unknown {
  const get = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const intent = get("intent");
  const asBool = (v: string | undefined) => v === "true";
  const asInt = (v: string | undefined) => (v === undefined ? undefined : parseInt(v, 10));

  switch (intent) {
    case "set-working-segments": {
      const segmentsRaw = get("segments");
      let segments: unknown = [];
      if (segmentsRaw) {
        try {
          segments = JSON.parse(segmentsRaw);
        } catch {
          // Leave as empty; zod will surface the validation error.
        }
      }
      return {
        intent,
        dayOfWeek: asInt(get("dayOfWeek")),
        segments,
      };
    }
    case "copy-weekdays":
    case "reset-working-hours":
      return { intent };
    case "set-event-buffer":
      return { intent, defaultEventBufferMin: asInt(get("defaultEventBufferMin")) };
    case "add-manual-block":
      return {
        intent,
        title: get("title"),
        startTime: get("startTime"),
        endTime: get("endTime"),
        allDay: get("allDay") ? asBool(get("allDay")) : false,
        recurrenceRule: get("recurrenceRule") || null,
      };
    case "update-manual-block":
      return {
        intent,
        id: get("id"),
        title: get("title"),
        startTime: get("startTime"),
        endTime: get("endTime"),
        allDay: get("allDay") === undefined ? undefined : asBool(get("allDay")),
        recurrenceRule:
          get("recurrenceRule") === undefined ? undefined : get("recurrenceRule") || null,
      };
    case "remove-manual-block":
      return { intent, id: get("id") };
    case "remove-calendar-link":
      return { intent, linkId: get("linkId") };
    case "toggle-sub-calendar":
      return {
        intent,
        linkId: get("linkId"),
        calendarId: get("calendarId"),
        enabled: asBool(get("enabled")),
      };
    default:
      return raw;
  }
}

type Tab = "availability" | "schedule";

export default function CalendarPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const [tab, setTab] = useState<Tab>("availability");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <PillButton active={tab === "availability"} onClick={() => setTab("availability")}>
          My Availability
        </PillButton>
        <PillButton active={tab === "schedule"} onClick={() => setTab("schedule")}>
          Schedule Meeting
        </PillButton>
      </div>

      {tab === "availability" ? <AvailabilityView data={data} /> : <ScheduleView data={data} />}
    </div>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
        active
          ? "bg-accent-coral text-white"
          : "text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Availability view                                                   */
/* ------------------------------------------------------------------ */

function AvailabilityView({ data }: { data: LoaderData }) {
  // Fill the available iframe viewport (minus tab bar + page padding) so the
  // grid extends to the screen edge. Floor at 56rem so the 13-hour grid never
  // gets clipped by the inner overflow-hidden on short viewports.
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 lg:h-[max(calc(100vh-9rem),56rem)] lg:min-h-0">
      <aside className="flex flex-col gap-6 lg:overflow-y-auto lg:overflow-x-hidden lg:pr-2 lg:min-h-0">
        <header>
          <h1 className="font-heading text-2xl font-bold text-foreground">Availability</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure when you're available for meetings and pairing.
          </p>
        </header>
        <CalendarIntegrationsCard links={data.calendarLinks} ingestionError={data.ingestionError} />
        <WorkingHoursCard workingHours={data.workingHours} />
        <EventBuffersCard bufferMin={data.defaultEventBufferMin} />
        <ManualBlocksCard blocks={data.manualBlocks} timezone={data.timezone} />
      </aside>
      <div className="lg:overflow-hidden lg:min-h-0">
        <AvailabilityWeekGrid data={data} />
      </div>
    </div>
  );
}

function CalendarIntegrationsCard({
  links,
  ingestionError,
}: {
  links: CalendarLinkDTO[];
  ingestionError: string | null;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <CalendarDays className="w-4 h-4 text-accent-coral" />
          Calendar Integrations
        </h2>
        {/* `<a target="_top">` — Google's auth page sends X-Frame-Options: DENY, so
            it can't render inside the workspace iframe. Break out to the top window. */}
        <a
          href="/oauth/calendar/google/start"
          target="_top"
          rel="noopener"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Google Account
        </a>
      </div>
      {ingestionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-2">
          Couldn't refresh external events: {ingestionError}
        </div>
      )}
      <div className="flex flex-col gap-3">
        {links.length === 0 && (
          <div className="bg-card border border-border rounded-md p-3 text-xs text-muted-foreground">
            No external calendars connected. Click <em>Add Google Account</em> above to link one.
          </div>
        )}
        {links.map((l) => (
          <CalendarLinkBlock key={l.id} link={l} />
        ))}
      </div>
    </section>
  );
}

function CalendarLinkBlock({ link }: { link: CalendarLinkDTO }) {
  const removeFetcher = useFetcher();
  return (
    <div className="bg-card border border-border border-l-4 border-l-accent-teal rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-accent-teal/10">
        <div className="flex items-center gap-2 min-w-0">
          <GoogleIcon />
          <span className="font-semibold text-sm text-foreground truncate">
            {link.displayName ?? link.externalEmail}
          </span>
        </div>
        <removeFetcher.Form method="post">
          <input type="hidden" name="intent" value="remove-calendar-link" />
          <input type="hidden" name="linkId" value={link.id} />
          <button
            type="submit"
            aria-label={`Remove ${link.externalEmail}`}
            className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </removeFetcher.Form>
      </div>
      <div className="px-3 py-3 flex flex-col gap-2">
        {link.syncError && (
          <div className="text-[11px] text-destructive">Sync error: {link.syncError}</div>
        )}
        <p className="text-xs text-muted-foreground">
          Select which calendars should block your availability:
        </p>
        {link.subCalendars === null ? (
          <div className="text-xs text-muted-foreground italic">
            Couldn't load this account's calendars.
          </div>
        ) : link.subCalendars.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">No calendars found.</div>
        ) : (
          link.subCalendars.map((cal) => (
            <SubCalendarRow key={cal.id} linkId={link.id} cal={cal} />
          ))
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function SubCalendarRow({ linkId, cal }: { linkId: string; cal: SubCalendarDTO }) {
  const fetcher = useFetcher();
  const pending = fetcher.formData;
  const enabled = pending ? pending.get("enabled") === "true" : cal.enabled;
  return (
    <button
      type="button"
      onClick={() =>
        fetcher.submit(
          {
            intent: "toggle-sub-calendar",
            linkId,
            calendarId: cal.id,
            enabled: String(!enabled),
          },
          { method: "post" },
        )
      }
      className="flex items-center justify-between text-left hover:bg-muted/50 rounded-md px-1 py-1 transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: cal.color ?? "var(--accent-coral)" }}
        />
        <span className="text-sm text-foreground truncate">{cal.summary}</span>
        {cal.primary && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Primary
          </span>
        )}
      </div>
      <span
        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors flex-shrink-0 ${
          enabled
            ? "bg-accent-coral border-accent-coral text-white"
            : "border-border bg-background"
        }`}
      >
        {enabled && (
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        )}
      </span>
    </button>
  );
}

function WorkingHoursCard({ workingHours }: { workingHours: WhDay[] }) {
  const copyFetcher = useFetcher();
  const resetFetcher = useFetcher();
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <Clock className="w-4 h-4 text-accent-coral" />
          Working Hours
        </h2>
        <div className="flex items-center gap-1">
          <copyFetcher.Form method="post">
            <input type="hidden" name="intent" value="copy-weekdays" />
            <button
              type="submit"
              title="Copy Monday's hours to Tue–Fri"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
            >
              <Copy className="w-3 h-3" />
              Weekdays
            </button>
          </copyFetcher.Form>
          <resetFetcher.Form method="post">
            <input type="hidden" name="intent" value="reset-working-hours" />
            <button
              type="submit"
              aria-label="Reset working hours to defaults"
              title="Reset to defaults"
              className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </resetFetcher.Form>
        </div>
      </div>
      <div className="bg-card border border-border rounded-md p-3 flex flex-col gap-2">
        {workingHours.map((d) => (
          <DayRow key={d.dayOfWeek} day={d} />
        ))}
      </div>
    </section>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type LocalSegment = { startMinute: number; endMinute: number; location: "InPerson" | "Remote" };

function DayRow({ day }: { day: WhDay }) {
  const fetcher = useFetcher();
  // Optimistic state: while a submit is pending, render the in-flight values
  // rather than the loader values so edits feel instant.
  const pending = fetcher.formData;
  const pendingSegments: LocalSegment[] | null = (() => {
    if (!pending) return null;
    const raw = pending.get("segments");
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as LocalSegment[];
    } catch {
      return null;
    }
  })();
  const segments: LocalSegment[] =
    pendingSegments ??
    day.segments.map((s) => ({
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      location: s.location,
    }));

  const enabled = segments.length > 0;

  const submitSegments = (next: LocalSegment[]) => {
    fetcher.submit(
      {
        intent: "set-working-segments",
        dayOfWeek: String(day.dayOfWeek),
        segments: JSON.stringify(next),
      },
      { method: "post" },
    );
  };

  const toggleEnabled = () => {
    if (enabled) submitSegments([]);
    else
      submitSegments([
        { startMinute: DEFAULT_WORK_START_MIN, endMinute: DEFAULT_WORK_END_MIN, location: "InPerson" },
      ]);
  };

  const updateSegment = (idx: number, patch: Partial<LocalSegment>) => {
    const next = segments.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    submitSegments(next);
  };

  const removeSegment = (idx: number) => {
    submitSegments(segments.filter((_, i) => i !== idx));
  };

  const addSegment = () => {
    // Default new segment to start where the last one ends (or 9am if empty).
    const last = segments[segments.length - 1];
    const start = last ? Math.min(last.endMinute, 1380) : DEFAULT_WORK_START_MIN;
    const end = Math.min(start + 60, 1440);
    submitSegments([...segments, { startMinute: start, endMinute: end, location: "InPerson" }]);
  };

  return (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={toggleEnabled}
        className={`mt-1.5 w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
          enabled ? "bg-accent-coral border-accent-coral text-white" : "border-border bg-background"
        }`}
        aria-label={`${DAY_LABELS[day.dayOfWeek]} enabled`}
      >
        {enabled && (
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        )}
      </button>
      <span className="mt-1 text-sm font-medium text-foreground w-9 flex-shrink-0">
        {DAY_LABELS[day.dayOfWeek]}
      </span>
      {enabled ? (
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          {segments.map((seg, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <TimeField
                valueMin={seg.startMinute}
                onCommit={(min) => updateSegment(idx, { startMinute: min })}
                aria-label={`${DAY_LABELS[day.dayOfWeek]} segment ${idx + 1} start`}
              />
              <span className="text-muted-foreground text-sm">–</span>
              <TimeField
                valueMin={seg.endMinute}
                onCommit={(min) => updateSegment(idx, { endMinute: min })}
                aria-label={`${DAY_LABELS[day.dayOfWeek]} segment ${idx + 1} end`}
              />
              <div className="flex items-center gap-0.5 ml-auto">
                <LocButton
                  active={seg.location === "InPerson"}
                  onClick={() => updateSegment(idx, { location: "InPerson" })}
                  icon={<Building2 className="w-3.5 h-3.5" />}
                />
                <LocButton
                  active={seg.location === "Remote"}
                  onClick={() => updateSegment(idx, { location: "Remote" })}
                  icon={<Wifi className="w-3.5 h-3.5" />}
                />
              </div>
              <button
                type="button"
                onClick={() => removeSegment(idx)}
                aria-label={`Remove ${DAY_LABELS[day.dayOfWeek]} segment ${idx + 1}`}
                title="Remove segment"
                className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addSegment}
            className="self-start inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md border border-dashed border-border text-muted-foreground hover:bg-muted transition-colors"
          >
            <Plus className="w-3 h-3" /> Add segment
          </button>
        </div>
      ) : (
        <span className="mt-1 text-sm text-muted-foreground italic ml-1">Unavailable</span>
      )}
    </div>
  );
}

function TimeField({
  valueMin,
  onCommit,
  ...rest
}: { valueMin: number; onCommit: (min: number) => void } & React.AriaAttributes) {
  const [text, setText] = useState(formatTime(valueMin));
  // Keep text in sync if the canonical value changes externally (e.g. after submit).
  // Using a key on the parent would be cleaner, but a defaultValue + onBlur commit
  // is enough for this UI.
  return (
    <div className="relative">
      <input
        {...rest}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = parseTime(text);
          if (parsed === null || parsed === valueMin) {
            setText(formatTime(valueMin));
            return;
          }
          onCommit(parsed);
        }}
        className="w-[88px] pl-2 pr-6 py-1 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
      />
      <Clock className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
    </div>
  );
}

function formatTime(minOfDay: number): string {
  const h = Math.floor(minOfDay / 60);
  const m = minOfDay % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

function parseTime(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  const period = m[3]?.toUpperCase();
  if (period === "PM" && h < 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function LocButton({ active, onClick, icon }: { active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors ${
        active ? "bg-accent-coral/20 text-accent-coral" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {icon}
    </button>
  );
}

function EventBuffersCard({ bufferMin }: { bufferMin: number }) {
  const fetcher = useFetcher();
  const pending = fetcher.formData;
  const selectedMin = pending ? Number(pending.get("defaultEventBufferMin")) : bufferMin;
  const options: { label: string; value: number }[] = [
    { label: "None", value: 0 },
    { label: "5m", value: 5 },
    { label: "10m", value: 10 },
    { label: "15m", value: 15 },
    { label: "30m", value: 30 },
    { label: "45m", value: 45 },
    { label: "60m", value: 60 },
  ];
  return (
    <section>
      <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground mb-3">
        <Shield className="w-4 h-4 text-accent-coral" />
        Event Buffers
      </h2>
      <div className="bg-card border border-border rounded-md p-3">
        <p className="text-xs text-muted-foreground mb-3">
          Add padding around all calendar and manual events so you're never booked back-to-back.
        </p>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() =>
                fetcher.submit(
                  { intent: "set-event-buffer", defaultEventBufferMin: String(o.value) },
                  { method: "post" },
                )
              }
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                selectedMin === o.value
                  ? "bg-accent-coral text-white"
                  : "bg-background text-foreground border border-border hover:bg-muted"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          {selectedMin === 0
            ? "No buffer will be added between events."
            : `A ${selectedMin}-minute buffer will be added before and after every event.`}
        </p>
      </div>
    </section>
  );
}

function ManualBlocksCard({ blocks, timezone }: { blocks: ManualBlockDTO[]; timezone: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <CalendarIcon className="w-4 h-4 text-accent-coral" />
          Manual Blocks
        </h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {adding ? "Cancel" : "Add Block"}
        </button>
      </div>
      {adding && <AddManualBlockForm onDone={() => setAdding(false)} />}
      <div className="flex flex-col gap-2">
        {blocks.length === 0 && !adding && (
          <div className="text-xs text-muted-foreground italic">No manual blocks.</div>
        )}
        {blocks.map((b) => (
          <ManualBlockRow key={b.id} block={b} timezone={timezone} />
        ))}
      </div>
    </section>
  );
}

function AddManualBlockForm({ onDone }: { onDone: () => void }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form
      method="post"
      onSubmit={() => {
        // Optimistically close the form; the loader revalidation will reveal the new row.
        queueMicrotask(onDone);
      }}
      className="bg-card border border-border rounded-md p-3 mb-2 flex flex-col gap-2"
    >
      <input type="hidden" name="intent" value="add-manual-block" />
      <input
        name="title"
        placeholder="Title (e.g. Dentist)"
        required
        className="px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground"
      />
      <div className="flex gap-2">
        <label className="flex-1 text-xs text-muted-foreground flex flex-col gap-1">
          Start
          <input
            type="datetime-local"
            name="startTimeLocal"
            required
            className="px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground"
            onChange={(e) => {
              const dt = e.currentTarget.value ? new Date(e.currentTarget.value).toISOString() : "";
              const hidden = e.currentTarget.form?.querySelector<HTMLInputElement>('input[name="startTime"]');
              if (hidden) hidden.value = dt;
            }}
          />
          <input type="hidden" name="startTime" />
        </label>
        <label className="flex-1 text-xs text-muted-foreground flex flex-col gap-1">
          End
          <input
            type="datetime-local"
            name="endTimeLocal"
            required
            className="px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground"
            onChange={(e) => {
              const dt = e.currentTarget.value ? new Date(e.currentTarget.value).toISOString() : "";
              const hidden = e.currentTarget.form?.querySelector<HTMLInputElement>('input[name="endTime"]');
              if (hidden) hidden.value = dt;
            }}
          />
          <input type="hidden" name="endTime" />
        </label>
      </div>
      <input
        name="recurrenceRule"
        placeholder="Recurrence (RRULE, optional, e.g. FREQ=WEEKLY;BYDAY=MO)"
        className="px-2 py-1 text-xs border border-border rounded-md bg-background text-foreground"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="px-3 py-1 text-xs font-medium rounded-md border border-border hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1 text-xs font-semibold rounded-md bg-accent-coral text-white hover:bg-accent-coral/90"
        >
          Add
        </button>
      </div>
    </fetcher.Form>
  );
}

function ManualBlockRow({ block, timezone }: { block: ManualBlockDTO; timezone: string }) {
  const fetcher = useFetcher();
  const removing = fetcher.state !== "idle";
  return (
    <div
      className={`bg-card border border-border border-l-4 border-l-accent-coral rounded-md px-3 py-2 flex items-start justify-between ${
        removing ? "opacity-50" : ""
      }`}
    >
      <div>
        <div className="text-sm font-medium text-foreground">{block.title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {formatBlockRange(block.startTime, block.endTime, timezone)}
          {block.recurrenceRule && (
            <span className="ml-1 italic">· {block.recurrenceRule}</span>
          )}
        </div>
      </div>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="remove-manual-block" />
        <input type="hidden" name="id" value={block.id} />
        <button
          type="submit"
          aria-label={`Remove ${block.title}`}
          disabled={removing}
          className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </fetcher.Form>
    </div>
  );
}

function formatBlockRange(startIso: string, endIso: string, timezone: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  const t = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date} · ${t(start)} – ${t(end)}`;
}

/* ------------------------------------------------------------------ */
/* Week grids                                                          */
/* ------------------------------------------------------------------ */

function shiftWeekParam(weekStartIso: string, weeks: number): string {
  const d = new Date(weekStartIso);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  // YYYY-MM-DD is enough — the loader snaps to the Sunday of that week.
  return d.toISOString().slice(0, 10);
}

function WeekToolbar({
  legend,
  monthLabel,
  weekStartIso,
  onRefresh,
  refreshing,
}: {
  legend: { color: string; label: string }[];
  monthLabel: string;
  weekStartIso: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  // Use URL-relative resolution so "?weekStart=…" stays on /calendar instead of
  // bubbling up to the parent route (which would land on /).
  const prev = `?weekStart=${shiftWeekParam(weekStartIso, -1)}`;
  const next = `?weekStart=${shiftWeekParam(weekStartIso, 1)}`;
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-lg font-bold text-foreground">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <Link
            to={prev}
            relative="path"
            aria-label="Previous week"
            preventScrollReset
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <Link
            to="?"
            relative="path"
            preventScrollReset
            className="px-3 py-1 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors"
          >
            Today
          </Link>
          <Link
            to={next}
            relative="path"
            aria-label="Next week"
            preventScrollReset
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </Link>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh availability"
              title="Refresh availability"
              className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {legend.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded-sm ${l.color}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const HOUR_PX = 56;

// Refetch when the tab regains focus (visibilitychange covers tab switches,
// focus covers window-level focus on browsers that don't fire visibilitychange
// for window blur). Used so external Google Calendar edits show up without a
// manual reload.
function useRefreshOnFocus(refresh: () => void) {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
}

function AvailabilityWeekGrid({ data }: { data: LoaderData }) {
  const revalidator = useRevalidator();
  const refresh = () => revalidator.revalidate();
  useRefreshOnFocus(refresh);
  const weekStart = new Date(data.weekStartIso);
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart.getTime() + i * 86_400_000);
    return { dayOfWeek: d.getUTCDay(), num: d.getUTCDate(), dateUtc: d };
  });

  // Build per-day event blocks from busy intervals.
  const eventsByDay: Record<number, EventBlock[]> = {};
  for (const b of data.busyIntervals) {
    const start = new Date(b.startIso);
    const end = new Date(b.endIso);
    const ymd = getZonedYMD(start, data.timezone);
    const dayMidnight = zonedDayStartUtc(ymd.year, ymd.month, ymd.day, data.timezone);
    const startHour = (start.getTime() - dayMidnight.getTime()) / 3_600_000;
    const duration = (end.getTime() - start.getTime()) / 3_600_000;
    const dayIdx = days.findIndex(
      (d) => d.dateUtc.getUTCFullYear() === ymd.year && d.dateUtc.getUTCMonth() + 1 === ymd.month && d.dateUtc.getUTCDate() === ymd.day,
    );
    if (dayIdx < 0) continue;
    if (!eventsByDay[dayIdx]) eventsByDay[dayIdx] = [];
    eventsByDay[dayIdx].push({
      startHour,
      duration,
      label: "Busy",
      className: EVENT_CORAL,
      borderClassName: "border-accent-coral-light",
    });
  }

  const monthLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: data.timezone,
    month: "long",
    year: "numeric",
  }).format(weekStart);

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col">
      <WeekToolbar
        monthLabel={monthLabel}
        weekStartIso={data.weekStartIso}
        onRefresh={refresh}
        refreshing={revalidator.state !== "idle"}
        legend={[
          { color: "bg-accent-green", label: "Available" },
          { color: "bg-muted", label: "Outside Hours" },
          { color: "bg-accent-coral", label: "Busy" },
        ]}
      />
      <WeekGrid
        days={days}
        showProviderRow
        backgroundLayer={(dayIdx) =>
          workingHoursStripeLayer(data.workingHours, days[dayIdx].dayOfWeek, { wash: true })
        }
        eventsByDay={eventsByDay}
      />
    </section>
  );
}

// Hard-coded dark text that doesn't flip in dark mode (the dark-blue token does).
const EVENT_TEXT = "text-[hsl(203_38%_18%)]";
const EVENT_CORAL = `bg-accent-coral-light ${EVENT_TEXT}`;

/* ------------------------------------------------------------------ */
/* Schedule view                                                        */
/* ------------------------------------------------------------------ */

type Repeats = "none" | "daily" | "weekly" | "monthly";

const REPEATS_OPTIONS: { value: Repeats; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function repeatsToRRule(r: Repeats): string | null {
  switch (r) {
    case "daily":
      return "FREQ=DAILY";
    case "weekly":
      return "FREQ=WEEKLY";
    case "monthly":
      return "FREQ=MONTHLY";
    case "none":
    default:
      return null;
  }
}

// datetime-local strings: "YYYY-MM-DDTHH:mm" in the user's local timezone.
function durationMinutesBetween(startLocal: string, endLocal: string): number {
  if (!startLocal || !endLocal) return 30;
  const s = new Date(startLocal).getTime();
  const e = new Date(endLocal).getTime();
  if (isNaN(s) || isNaN(e) || e <= s) return 30;
  return Math.round((e - s) / 60_000);
}

// Format a Date as the "YYYY-MM-DDTHH:mm" string a datetime-local input expects,
// in the browser's local timezone (no UTC offset suffix).
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function ScheduleView({ data }: { data: LoaderData }) {
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [startLocal, setStartLocal] = useState<string>("");
  const [endLocal, setEndLocal] = useState<string>("");

  const groupsById = new Map(data.groups.map((g) => [g.id, g]));
  const resolvedParticipantIds = (() => {
    const set = new Set<string>(selectedUserIds);
    for (const gid of selectedGroupIds) {
      const g = groupsById.get(gid);
      if (g) for (const uid of g.staticMemberIds) set.add(uid);
    }
    return Array.from(set);
  })();

  const duration = durationMinutesBetween(startLocal, endLocal);

  const handleGridSelect = (newStartLocal: string, newEndLocal: string) => {
    setStartLocal(newStartLocal);
    setEndLocal(newEndLocal);
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-full min-w-0 lg:min-h-[calc(100vh-9rem)]">
      <CreateScheduledMeetingForm
        groups={data.groups}
        users={data.users}
        calendarLinks={data.calendarLinks}
        startLocal={startLocal}
        onStartLocalChange={setStartLocal}
        endLocal={endLocal}
        onEndLocalChange={setEndLocal}
        selectedUserIds={selectedUserIds}
        onChangeSelectedUserIds={setSelectedUserIds}
        selectedGroupIds={selectedGroupIds}
        onChangeSelectedGroupIds={setSelectedGroupIds}
        resolvedParticipantIds={resolvedParticipantIds}
      />
      <ScheduleWeekGrid
        // The organizer is always implicitly invited, so include them in the
        // availability query — otherwise the "All free" overlay can paint over
        // times when the sender themself is busy.
        participantIds={
          resolvedParticipantIds.length > 0
            ? Array.from(new Set([...resolvedParticipantIds, data.currentUserId]))
            : [data.currentUserId]
        }
        showingSelfOnly={resolvedParticipantIds.length === 0}
        users={data.users}
        workingHours={data.workingHours}
        durationMinutes={duration}
        timezone={data.timezone}
        weekStartIso={data.weekStartIso}
        weekEndIso={data.weekEndIso}
        onSelectRange={handleGridSelect}
        selectedStartLocal={startLocal}
        selectedEndLocal={endLocal}
      />
    </div>
  );
}

function userLabel(u: UserOption) {
  const name = `${u.firstName} ${u.lastName}`.trim();
  return name || u.daliEmail || u.id;
}

function CreateScheduledMeetingForm({
  groups,
  users,
  calendarLinks,
  startLocal,
  onStartLocalChange,
  endLocal,
  onEndLocalChange,
  selectedUserIds,
  onChangeSelectedUserIds,
  selectedGroupIds,
  onChangeSelectedGroupIds,
  resolvedParticipantIds,
}: {
  groups: GroupOption[];
  users: UserOption[];
  calendarLinks: CalendarLinkDTO[];
  startLocal: string;
  onStartLocalChange: (v: string) => void;
  endLocal: string;
  onEndLocalChange: (v: string) => void;
  selectedUserIds: string[];
  onChangeSelectedUserIds: (ids: string[]) => void;
  selectedGroupIds: string[];
  onChangeSelectedGroupIds: (ids: string[]) => void;
  resolvedParticipantIds: string[];
}) {
  const [title, setTitle] = useState("");
  const [repeats, setRepeats] = useState<Repeats>("none");
  const googleLinks = calendarLinks.filter((l) => l.provider === "Google" && l.enabled);
  const [organizerCalendarLinkId, setOrganizerCalendarLinkId] = useState<string>(
    googleLinks[0]?.id ?? "",
  );
  const [status, setStatus] = useState<
    | null
    | { ok: true; count: number; gcalError?: string | null }
    | { ok: false; error: string }
  >(null);
  const [submitting, setSubmitting] = useState(false);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const groupsById = new Map(groups.map((g) => [g.id, g]));

  // Both pickers filled → derive duration; otherwise fall back to 30 min so
  // "schedule later" (no start/end yet) still produces a valid payload.
  const duration = durationMinutesBetween(startLocal, endLocal);
  const startEndValid =
    !startLocal || !endLocal || new Date(endLocal).getTime() > new Date(startLocal).getTime();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        durationMinutes: duration,
      };
      const rrule = repeatsToRRule(repeats);
      if (rrule) payload.recurrenceRule = rrule;
      if (startLocal) {
        // datetime-local has no timezone; interpret it in the browser's zone
        // and send a real ISO string with offset.
        const localDate = new Date(startLocal);
        if (!isNaN(localDate.getTime())) {
          payload.startTime = localDate.toISOString();
        }
      }
      if (organizerCalendarLinkId) {
        payload.organizerCalendarLinkId = organizerCalendarLinkId;
      }

      // If exactly one group is picked and no extra people are added, record the
      // group scope so notifications carry sourceGroupId. Otherwise submit as UserList.
      if (selectedGroupIds.length === 1 && selectedUserIds.length === 0) {
        payload.scopeType = "Group";
        payload.groupId = selectedGroupIds[0];
      } else if (resolvedParticipantIds.length > 0) {
        payload.scopeType = "UserList";
        payload.participantUserIds = resolvedParticipantIds;
      } else {
        payload.scopeType = "None";
      }

      const res = await fetch("/api/scheduled-meetings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus({ ok: false, error: json.error ?? "Failed to create meeting" });
      } else {
        setStatus({ ok: true, count: json.notifiedCount ?? 0, gcalError: json.gcalError ?? null });
        setTitle("");
        setRepeats("none");
        onStartLocalChange("");
        onEndLocalChange("");
        onChangeSelectedUserIds([]);
        onChangeSelectedGroupIds([]);
      }
    } catch (err) {
      setStatus({ ok: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = title.trim().length > 0 && duration > 0 && startEndValid && !submitting;

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <h2 className="font-heading font-semibold text-foreground mb-3">Create Meeting</h2>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="meeting-title" className="block text-sm font-medium text-foreground mb-1">
            Title
          </label>
          <input
            id="meeting-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="meeting-start" className="block text-sm font-medium text-foreground mb-1">
              Starts <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              id="meeting-start"
              type="datetime-local"
              value={startLocal}
              onChange={(e) => {
                const next = e.target.value;
                onStartLocalChange(next);
                // If end is missing or now precedes start, push it to start + current duration.
                if (next && (!endLocal || new Date(endLocal).getTime() <= new Date(next).getTime())) {
                  const d = new Date(next);
                  d.setMinutes(d.getMinutes() + (duration > 0 ? duration : 30));
                  onEndLocalChange(toDatetimeLocal(d));
                }
              }}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/40"
            />
          </div>
          <div>
            <label htmlFor="meeting-end" className="block text-sm font-medium text-foreground mb-1">
              Ends
            </label>
            <input
              id="meeting-end"
              type="datetime-local"
              value={endLocal}
              min={startLocal || undefined}
              onChange={(e) => onEndLocalChange(e.target.value)}
              className={`w-full px-3 py-2 text-sm border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/40 ${
                startEndValid ? "border-border" : "border-red-500"
              }`}
            />
            {!startEndValid && (
              <p className="mt-1 text-xs text-red-600">End must be after start.</p>
            )}
          </div>
        </div>
        <div>
          <label htmlFor="meeting-recurrence" className="block text-sm font-medium text-foreground mb-1">
            Repeats
          </label>
          <select
            id="meeting-recurrence"
            value={repeats}
            onChange={(e) => setRepeats(e.target.value as Repeats)}
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
          >
            {REPEATS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="organizer-calendar" className="block text-sm font-medium text-foreground mb-1">
            Send invite from
          </label>
          {googleLinks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No Google calendar linked. Link one in the My Availability tab to send Gmail invites.
            </p>
          ) : (
            <select
              id="organizer-calendar"
              value={organizerCalendarLinkId}
              onChange={(e) => setOrganizerCalendarLinkId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
            >
              <option value="">No invite (in-app notification only)</option>
              {googleLinks.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.displayName ? `${l.displayName} — ${l.externalEmail}` : l.externalEmail}
                </option>
              ))}
            </select>
          )}
        </div>

        <ParticipantPicker
          users={users}
          groups={groups}
          selectedUserIds={selectedUserIds}
          selectedGroupIds={selectedGroupIds}
          onChangeUsers={onChangeSelectedUserIds}
          onChangeGroups={onChangeSelectedGroupIds}
          usersById={usersById}
          groupsById={groupsById}
          resolvedCount={resolvedParticipantIds.length}
        />

        <div className="flex items-center justify-between pt-1">
          <div className="text-sm">
            {status?.ok === true && (
              <span className="text-green-700">
                Meeting created. Notified {status.count} participant{status.count === 1 ? "" : "s"}.
                {status.gcalError ? ` (Google Calendar push failed: ${status.gcalError})` : ""}
              </span>
            )}
            {status?.ok === false && <span className="text-red-700">{status.error}</span>}
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm hover:bg-gray-700 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create meeting"}
          </button>
        </div>
      </form>
    </section>
  );
}

type AddingMode = null | "user" | "group";

function ParticipantPicker({
  users,
  groups,
  selectedUserIds,
  selectedGroupIds,
  onChangeUsers,
  onChangeGroups,
  usersById,
  groupsById,
  resolvedCount,
}: {
  users: UserOption[];
  groups: GroupOption[];
  selectedUserIds: string[];
  selectedGroupIds: string[];
  onChangeUsers: (ids: string[]) => void;
  onChangeGroups: (ids: string[]) => void;
  usersById: Map<string, UserOption>;
  groupsById: Map<string, GroupOption>;
  resolvedCount: number;
}) {
  const [adding, setAdding] = useState<AddingMode>(null);
  const [query, setQuery] = useState("");

  const availableUsers = users.filter((u) => !selectedUserIds.includes(u.id));
  const availableGroups = groups.filter((g) => !selectedGroupIds.includes(g.id));

  const filteredUsers = availableUsers.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      (u.daliEmail ?? "").toLowerCase().includes(q)
    );
  });
  const filteredGroups = availableGroups.filter((g) => {
    if (!query) return true;
    return g.name.toLowerCase().includes(query.toLowerCase());
  });

  function closePicker() {
    setAdding(null);
    setQuery("");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-sm font-medium text-foreground">Participants</label>
        <span className="text-xs text-muted-foreground">
          {resolvedCount} unique user{resolvedCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {selectedGroupIds.map((gid) => {
          const g = groupsById.get(gid);
          if (!g) return null;
          return (
            <span
              key={`g:${gid}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
              title={`${g.staticMemberIds.length} member${g.staticMemberIds.length === 1 ? "" : "s"}`}
            >
              <UsersRound className="w-3 h-3" />
              {g.name}
              <button
                type="button"
                onClick={() => onChangeGroups(selectedGroupIds.filter((x) => x !== gid))}
                aria-label={`Remove ${g.name}`}
                className="hover:text-blue-600"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}
        {selectedUserIds.map((uid) => {
          const u = usersById.get(uid);
          if (!u) return null;
          return (
            <span
              key={`u:${uid}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
            >
              {userLabel(u)}
              <button
                type="button"
                onClick={() => onChangeUsers(selectedUserIds.filter((x) => x !== uid))}
                aria-label={`Remove ${userLabel(u)}`}
                className="hover:text-purple-600"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}

        {adding === null && (
          <>
            <button
              type="button"
              onClick={() => setAdding("user")}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80"
            >
              <Plus className="w-3 h-3" /> Add user
            </button>
            <button
              type="button"
              onClick={() => setAdding("group")}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80"
            >
              <Plus className="w-3 h-3" /> Add user group
            </button>
          </>
        )}
      </div>

      {adding !== null && (
        <div className="mt-2 border border-border rounded-md bg-background p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              {adding === "user" ? "Pick a user" : "Pick a user group"}
            </span>
            <button
              type="button"
              onClick={closePicker}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={adding === "user" ? "Search by name or email…" : "Search by group name…"}
            className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground"
            autoFocus
          />
          <div className="max-h-48 overflow-y-auto">
            {adding === "user" ? (
              filteredUsers.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">No users match.</p>
              ) : (
                filteredUsers.slice(0, 50).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      onChangeUsers([...selectedUserIds, u.id]);
                      closePicker();
                    }}
                    className="w-full text-left px-2 py-1 text-sm hover:bg-muted/50 rounded"
                  >
                    {userLabel(u)}
                  </button>
                ))
              )
            ) : filteredGroups.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                No groups match.{" "}
                <a href="/members/groups" className="underline">
                  Create one
                </a>
                .
              </p>
            ) : (
              filteredGroups.slice(0, 50).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    onChangeGroups([...selectedGroupIds, g.id]);
                    closePicker();
                  }}
                  className="w-full text-left px-2 py-1 text-sm hover:bg-muted/50 rounded flex justify-between items-center"
                >
                  <span>{g.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {g.staticMemberIds.length} member{g.staticMemberIds.length === 1 ? "" : "s"}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type GroupAvailDay = {
  dayKey: string;
  dayOfWeek: number;
  dayOfMonth: number;
  matches: { startHour: number; durationHours: number }[];
  busy: { startHour: number; durationHours: number }[];
};

type PerUserFree = { userId: string; free: { startIso: string; endIso: string }[] };

type GroupAvailResponse = { days: GroupAvailDay[]; perUser: PerUserFree[] };

function ScheduleWeekGrid({
  participantIds,
  showingSelfOnly = false,
  users,
  workingHours,
  durationMinutes,
  timezone,
  weekStartIso,
  weekEndIso,
  onSelectRange,
  selectedStartLocal,
  selectedEndLocal,
}: {
  participantIds: string[];
  // True when the caller is rendering the current user's own availability
  // (no participants picked yet) — used to relabel the header / legend.
  showingSelfOnly?: boolean;
  users: UserOption[];
  // The viewer's own working hours, used to stripe out non-working hours.
  workingHours: WhDay[];
  durationMinutes: number;
  timezone: string;
  weekStartIso: string;
  weekEndIso: string;
  onSelectRange?: (startLocal: string, endLocal: string) => void;
  selectedStartLocal?: string;
  selectedEndLocal?: string;
}) {
  const [data, setData] = useState<GroupAvailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force the fetch effect to re-run without changing inputs (manual
  // refresh button + tab-focus refresh).
  const [refreshKey, setRefreshKey] = useState(0);
  const revalidator = useRevalidator();
  const refresh = () => {
    setRefreshKey((k) => k + 1);
    revalidator.revalidate();
  };
  useRefreshOnFocus(refresh);

  // Stable key so the effect only re-fires on a real change. participantIds
  // itself is a fresh array each render — using it as a dep would make this
  // effect cancel+restart every render, leaving "Loading…" stuck on the screen.
  const participantKey = participantIds.slice().sort().join(",");

  useEffect(() => {
    const ids = participantKey ? participantKey.split(",") : [];
    if (ids.length === 0) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/calendar/group-availability", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userIds: ids,
        weekStartIso,
        weekEndIso,
        durationMinutes,
        timezone,
      }),
    })
      .then(async (r) => {
        const json = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(json.error ?? "Failed to load availability");
          setData(null);
        } else {
          setData(json as GroupAvailResponse);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [participantKey, durationMinutes, weekStartIso, weekEndIso, timezone, refreshKey]);

  // Build the 7-day axis from the week window so empty days still render.
  const weekStart = new Date(weekStartIso);
  const days = Array.from({ length: 7 }).map((_, i) => {
    const dayDate = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
    return {
      dayOfWeek: dayDate.getUTCDay(),
      num: dayDate.getUTCDate(),
      dateUtc: dayDate,
    };
  });

  // When2Meet-style availability gradient: each 15-min cell is tinted by the
  // fraction of participants free at that time. We render the gradient as the
  // background layer, leaving the Busy blocks out entirely — free vs. busy is
  // already encoded in the cell's saturation.
  const eventsByDay: Record<number, EventBlock[]> = {};
  const totalParticipants = participantIds.length;
  const CELL_HOURS = 0.25;
  const GRID_START_H = HOURS[0];
  const GRID_END_H = HOURS[HOURS.length - 1] + 1;
  const CELLS_PER_DAY = Math.round((GRID_END_H - GRID_START_H) / CELL_HOURS);

  // Pre-parse each participant's free intervals into sorted (startMs, endMs)
  // tuples for fast containment checks below.
  const perUserFree: { startMs: number; endMs: number }[][] = data
    ? data.perUser.map((u) =>
        u.free
          .map((iv) => ({
            startMs: new Date(iv.startIso).getTime(),
            endMs: new Date(iv.endIso).getTime(),
          }))
          .sort((a, b) => a.startMs - b.startMs),
      )
    : [];

  function freeCountAtCell(cellStartMs: number, cellEndMs: number): number {
    let n = 0;
    for (const intervals of perUserFree) {
      let covered = false;
      for (const iv of intervals) {
        if (iv.endMs <= cellStartMs) continue;
        if (iv.startMs > cellStartMs) break;
        if (iv.startMs <= cellStartMs && iv.endMs >= cellEndMs) {
          covered = true;
        }
        break;
      }
      if (covered) n += 1;
    }
    return n;
  }

  // Build per-day cell tints. Each entry is { startHour, durationHours, alpha }
  // ready to render as a colored absolute-positioned block.
  type CellTint = { startHour: number; alpha: number };
  const tintsByColIdx: CellTint[][] = data
    ? days.map((d, colIdx) => {
        const cells: CellTint[] = [];
        const dayStartMs = weekStart.getTime() + colIdx * 86_400_000;
        for (let i = 0; i < CELLS_PER_DAY; i++) {
          const hour = GRID_START_H + i * CELL_HOURS;
          const cellStartMs = dayStartMs + hour * 3_600_000;
          const cellEndMs = cellStartMs + CELL_HOURS * 3_600_000;
          const k = freeCountAtCell(cellStartMs, cellEndMs);
          if (k === 0) continue;
          const alpha = totalParticipants > 0 ? k / totalParticipants : 0;
          cells.push({ startHour: hour, alpha });
        }
        // Reference d so the linter doesn't complain (we may use it later).
        void d;
        return cells;
      })
    : [];

  // Compute the selected-slot overlay (rendered separately so we can show a
  // hover popover with attending vs. unavailable participants).
  type SelectedSlot = {
    dow: number;
    startHour: number;
    duration: number;
    available: UserOption[];
    unavailable: UserOption[];
  };
  let selectedSlot: SelectedSlot | null = null;
  if (selectedStartLocal && selectedEndLocal && data && participantIds.length > 0) {
    const sd = new Date(selectedStartLocal);
    const ed = new Date(selectedEndLocal);
    if (!isNaN(sd.getTime()) && !isNaN(ed.getTime()) && ed.getTime() > sd.getTime()) {
      const sameDay = sd.toDateString() === ed.toDateString();
      const dow = sd.getDay();
      const startHour = sd.getHours() + sd.getMinutes() / 60;
      const endHour = ed.getHours() + ed.getMinutes() / 60;
      const duration = sameDay ? endHour - startHour : 24 - startHour;
      if (duration > 0) {
        // A user is "available" if their free intervals cover the entire
        // [sd, ed] window. We allow the union of multiple free intervals.
        const slotStartMs = sd.getTime();
        const slotEndMs = ed.getTime();
        const usersById = new Map(users.map((u) => [u.id, u]));
        const perUserById = new Map(data.perUser.map((p) => [p.userId, p]));
        const available: UserOption[] = [];
        const unavailable: UserOption[] = [];
        for (const uid of participantIds) {
          const user = usersById.get(uid) ?? {
            id: uid,
            firstName: uid,
            lastName: "",
            daliEmail: null,
          };
          const free = perUserById.get(uid)?.free ?? [];
          // Build the contiguous free-coverage over [slotStartMs, slotEndMs].
          // Sort & merge first, then walk.
          const sortedFree = free
            .map((iv) => ({ s: new Date(iv.startIso).getTime(), e: new Date(iv.endIso).getTime() }))
            .sort((a, b) => a.s - b.s);
          let cursor = slotStartMs;
          for (const iv of sortedFree) {
            if (iv.e <= cursor) continue;
            if (iv.s > cursor) break;
            cursor = Math.max(cursor, iv.e);
            if (cursor >= slotEndMs) break;
          }
          if (cursor >= slotEndMs) available.push(user);
          else unavailable.push(user);
        }
        selectedSlot = { dow, startHour, duration, available, unavailable };
      }
    }
  }

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col">
      <WeekToolbar
        monthLabel={showingSelfOnly ? "Your availability" : "Schedule preview"}
        weekStartIso={weekStartIso}
        onRefresh={refresh}
        refreshing={loading || revalidator.state !== "idle"}
        legend={
          showingSelfOnly
            ? [
                { color: "bg-[rgba(132,188,105,0.8)]", label: "Free" },
              ]
            : [
                { color: "bg-[rgba(132,188,105,0.18)]", label: "Few free" },
                { color: "bg-[rgba(132,188,105,0.5)]", label: "Some free" },
                { color: "bg-[rgba(132,188,105,0.8)]", label: "All free" },
              ]
        }
      />
      {participantIds.length === 0 ? null : (
        <>
          {loading && (
            <div className="px-4 py-1 text-xs text-muted-foreground">Loading availability…</div>
          )}
          {error && (
            <div className="px-4 py-2 text-xs text-red-700">{error}</div>
          )}
          {onSelectRange && (
            <p className="px-4 py-1 text-[11px] text-muted-foreground">
              Drag a range on the grid to set the meeting time.
            </p>
          )}
          <WeekGrid
            days={days}
            eventsByDay={eventsByDay}
            showQuarterHourGrid
            backgroundLayer={(dayIdx) => (
              <>
                {/* Gradient first so the working-hours stripes draw on top. */}
                {(tintsByColIdx[dayIdx] ?? []).map((t, i) => (
                  <BlockBlock
                    key={`tint-${i}`}
                    topHour={GRID_START_H}
                    startHour={t.startHour}
                    duration={CELL_HOURS}
                    style={{
                      backgroundColor: `rgba(132, 188, 105, ${0.15 + 0.65 * t.alpha})`,
                    }}
                  />
                ))}
                {workingHoursStripeLayer(workingHours, days[dayIdx].dayOfWeek)}
              </>
            )}
            overlayLayer={(dayIdx) => {
              if (!selectedSlot) return null;
              if (days[dayIdx]?.dayOfWeek !== selectedSlot.dow) return null;
              return (
                <SelectedSlotBlock
                  startHour={selectedSlot.startHour}
                  duration={selectedSlot.duration}
                  available={selectedSlot.available}
                  unavailable={selectedSlot.unavailable}
                />
              );
            }}
            onDayPointerSelect={
              onSelectRange
                ? (dayIdx, startHour, endHour) => {
                    const day = days[dayIdx];
                    if (!day) return;
                    const y = day.dateUtc.getUTCFullYear();
                    const m = day.dateUtc.getUTCMonth();
                    const d = day.dateUtc.getUTCDate();
                    const toLocal = (hour: number) => {
                      const h = Math.floor(hour);
                      const mins = Math.round((hour - h) * 60);
                      return toDatetimeLocal(new Date(y, m, d, h, mins));
                    };
                    onSelectRange(toLocal(startHour), toLocal(endHour));
                  }
                : undefined
            }
          />
        </>
      )}
    </section>
  );
}

function SelectedSlotBlock({
  startHour,
  duration,
  available,
  unavailable,
}: {
  startHour: number;
  duration: number;
  available: UserOption[];
  unavailable: UserOption[];
}) {
  const [open, setOpen] = useState(false);
  const total = available.length + unavailable.length;
  const top = (startHour - HOURS[0]) * HOUR_PX;
  const height = duration * HOUR_PX;
  return (
    <div
      className="absolute left-0 right-0 z-30 cursor-help"
      style={{
        top,
        height,
        borderWidth: "2px",
        borderStyle: "solid",
        borderColor: "var(--color-foreground)",
        borderRadius: "0.125rem",
        background: "transparent",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div
        className="m-1 inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold rounded-sm shadow-sm"
        style={{
          color: "var(--color-foreground)",
          backgroundColor: "var(--color-card)",
        }}
      >
        {available.length}/{total}
      </div>
      {open && (
        <div
          className="absolute left-full ml-2 top-0 z-40 w-56 rounded-md shadow-lg p-2 text-xs"
          style={{
            backgroundColor: "var(--color-card)",
            color: "var(--color-foreground)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div className="font-semibold mb-1 text-foreground">
            {available.length} of {total} can attend
          </div>
          {available.length > 0 && (
            <div className="mb-1.5">
              <div className="uppercase tracking-wide text-[10px] text-muted-foreground mb-0.5">
                Available
              </div>
              <ul className="space-y-0.5">
                {available.map((u) => (
                  <li key={u.id} className="text-green-700 dark:text-green-400">
                    {userLabel(u)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unavailable.length > 0 && (
            <div>
              <div className="uppercase tracking-wide text-[10px] text-muted-foreground mb-0.5">
                Busy
              </div>
              <ul className="space-y-0.5">
                {unavailable.map((u) => (
                  <li key={u.id} className="text-red-700 dark:text-red-400">
                    {userLabel(u)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Week grid primitives                                                */
/* ------------------------------------------------------------------ */

type EventBlock = {
  startHour: number;
  duration: number;
  label: string;
  /** Tailwind classes for the colored body (bg + text). */
  className: string;
  /** Border color class for the outer wrapper (defaults to matching the body). */
  borderClassName?: string;
  /** Background tint for the buffer strip + frame (e.g. "bg-accent-coral/25"). */
  bufferClassName?: string;
  /** Hours of buffer above the event body. */
  bufferBefore?: number;
  /** Hours of buffer below the event body. */
  bufferAfter?: number;
};

const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function WeekGrid({
  days,
  eventsByDay,
  backgroundLayer,
  overlayLayer,
  showProviderRow = false,
  onDayPointerSelect,
  showQuarterHourGrid = false,
}: {
  days: { dayOfWeek: number; num: number; dateUtc: Date }[];
  eventsByDay: Record<number, EventBlock[]>;
  backgroundLayer?: (dayIdx: number) => React.ReactNode;
  overlayLayer?: (dayIdx: number) => React.ReactNode;
  showProviderRow?: boolean;
  onDayPointerSelect?: (dayIdx: number, startHour: number, endHour: number) => void;
  showQuarterHourGrid?: boolean;
}) {
  // Drag-to-select state. We snap to 15-minute steps and clamp to the visible
  // hour range. dragAnchor is where mousedown happened; dragHover is where the
  // pointer currently is — both are stored as fractional hours.
  const [drag, setDrag] = useState<
    null | { dayIdx: number; anchor: number; hover: number }
  >(null);

  // Column DOM refs so window-level mousemove can compute Y relative to the
  // column the drag started in, even when the cursor strays elsewhere.
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);

  const SNAP_HOURS = 0.25; // 15 minutes
  const MIN_HOUR = HOURS[0];
  const MAX_HOUR = HOURS[HOURS.length - 1] + 1;

  const hourFromY = (offsetY: number): number => {
    const raw = MIN_HOUR + offsetY / HOUR_PX;
    const snapped = Math.round(raw / SNAP_HOURS) * SNAP_HOURS;
    return Math.max(MIN_HOUR, Math.min(MAX_HOUR, snapped));
  };

  const onDayMouseDown = (dayIdx: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onDayPointerSelect) return;
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const h = hourFromY(e.clientY - rect.top);
    setDrag({ dayIdx, anchor: h, hover: h });
    e.preventDefault();
  };

  // Window-level mousemove + mouseup so the drag keeps tracking even when the
  // cursor leaves the original column.
  useEffect(() => {
    if (!drag || !onDayPointerSelect) return;
    const col = columnRefs.current[drag.dayIdx];
    const onMove = (e: MouseEvent) => {
      if (!col) return;
      const rect = col.getBoundingClientRect();
      setDrag((prev) =>
        prev ? { ...prev, hover: hourFromY(e.clientY - rect.top) } : prev,
      );
    };
    const onUp = () => {
      const lo = Math.min(drag.anchor, drag.hover);
      const hi = Math.max(drag.anchor, drag.hover);
      const start = lo;
      const end = hi - lo < SNAP_HOURS ? Math.min(MAX_HOUR, lo + SNAP_HOURS * 2) : hi;
      onDayPointerSelect(drag.dayIdx, start, end);
      setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, onDayPointerSelect, MAX_HOUR]);

  return (
    <div className="flex border border-border rounded-md overflow-hidden select-none">
      {/* Hour axis */}
      <div className="flex flex-col w-14 border-r border-border bg-card text-[11px] text-muted-foreground">
        <div className={showProviderRow ? "h-16 border-b border-border" : "h-9 border-b border-border"} />
        {HOURS.map((h) => (
          <div key={h} style={{ height: HOUR_PX }} className="px-2 pt-1 text-right">
            {formatHour(h)}
          </div>
        ))}
      </div>
      {/* Day columns */}
      {days.map((d, idx) => (
        <div key={idx} className="flex-1 min-w-0 border-r last:border-r-0 border-border flex flex-col">
          <div className={`flex flex-col items-center justify-center border-b border-border ${showProviderRow ? "h-16" : "h-9"}`}>
            <div className="text-[10px] font-semibold text-muted-foreground tracking-wide">{DAY_KEYS[d.dayOfWeek]}</div>
            <div className="text-sm font-bold text-foreground">{d.num}</div>
            {showProviderRow && (
              <div className="flex items-center gap-0.5 mt-0.5 text-muted-foreground/50">
                <Building2 className="w-2.5 h-2.5" />
                <Wifi className="w-2.5 h-2.5" />
              </div>
            )}
          </div>
          <div
            ref={(el) => {
              columnRefs.current[idx] = el;
            }}
            className={`relative ${onDayPointerSelect ? "cursor-crosshair" : ""}`}
            style={{ height: HOURS.length * HOUR_PX }}
            onMouseDown={onDayPointerSelect ? onDayMouseDown(idx) : undefined}
          >
            {HOURS.map((_, i) => (
              <Fragment key={i}>
                <div
                  className="absolute left-0 right-0 border-t border-foreground/30"
                  style={{ top: i * HOUR_PX }}
                />
                {showQuarterHourGrid && (
                  <>
                    <div
                      className="absolute left-0 right-0 border-t border-foreground/30"
                      style={{ top: i * HOUR_PX + HOUR_PX * 0.25 }}
                    />
                    <div
                      className="absolute left-0 right-0 border-t border-foreground/30"
                      style={{ top: i * HOUR_PX + HOUR_PX * 0.5 }}
                    />
                    <div
                      className="absolute left-0 right-0 border-t border-foreground/30"
                      style={{ top: i * HOUR_PX + HOUR_PX * 0.75 }}
                    />
                  </>
                )}
              </Fragment>
            ))}
            {backgroundLayer?.(idx)}
            {drag && drag.dayIdx === idx && (() => {
              const lo = Math.min(drag.anchor, drag.hover);
              const hi = Math.max(drag.anchor, drag.hover);
              const heightHours = Math.max(SNAP_HOURS, hi - lo);
              return (
                <div
                  className="absolute left-0 right-0 border-2 pointer-events-none rounded-sm z-30 shadow-md"
                  style={{
                    top: (lo - MIN_HOUR) * HOUR_PX,
                    height: heightHours * HOUR_PX,
                    borderColor: "var(--color-foreground)",
                  }}
                >
                  <div
                    className="px-1 py-0.5 text-[11px] font-semibold rounded-sm m-1 inline-block shadow-sm"
                    style={{
                      color: "var(--color-foreground)",
                      backgroundColor: "var(--color-card)",
                    }}
                  >
                    {formatHourMinute(lo)} – {formatHourMinute(hi)}
                  </div>
                </div>
              );
            })()}
            {(eventsByDay[idx] ?? []).map((e, i) => {
              const bufferBefore = e.bufferBefore ?? 0;
              const bufferAfter = e.bufferAfter ?? 0;
              const totalHours = bufferBefore + e.duration + bufferAfter;
              // Outer ring is opt-in: only events that supply a borderClassName
              // get a 2px outline (e.g. the drag selection). Plain fills like
              // Available / Busy render without an outline.
              const border = e.borderClassName ? `border-2 ${e.borderClassName}` : "";
              const bufferBg = e.bufferClassName ?? "";
              return (
                <div
                  key={i}
                  className={`absolute left-0 right-0 ${border} ${bufferBg} overflow-hidden`}
                  style={{
                    top: (e.startHour - bufferBefore - HOURS[0]) * HOUR_PX,
                    height: totalHours * HOUR_PX,
                  }}
                >
                  <div
                    className={`absolute left-0 right-0 px-1.5 py-1 text-[11px] font-medium overflow-hidden ${e.className}`}
                    style={{
                      top: bufferBefore * HOUR_PX,
                      height: e.duration * HOUR_PX,
                    }}
                  >
                    {e.label && <span className="truncate block">{e.label}</span>}
                  </div>
                </div>
              );
            })}
            {overlayLayer?.(idx)}
            {showQuarterHourGrid &&
              HOURS.map((_, i) => (
                <Fragment key={`grid-fg-${i}`}>
                  <div
                    className="absolute left-0 right-0 border-t border-foreground/20 pointer-events-none z-20"
                    style={{ top: i * HOUR_PX }}
                  />
                  <div
                    className="absolute left-0 right-0 border-t border-foreground/20 pointer-events-none z-20"
                    style={{ top: i * HOUR_PX + HOUR_PX * 0.25 }}
                  />
                  <div
                    className="absolute left-0 right-0 border-t border-foreground/20 pointer-events-none z-20"
                    style={{ top: i * HOUR_PX + HOUR_PX * 0.5 }}
                  />
                  <div
                    className="absolute left-0 right-0 border-t border-foreground/20 pointer-events-none z-20"
                    style={{ top: i * HOUR_PX + HOUR_PX * 0.75 }}
                  />
                </Fragment>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatHour(h: number) {
  if (h === 12) return "12 PM";
  if (h === 0) return "12 AM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

// Fractional hour → "9:15 AM" / "12:00 PM" style label for drag tooltips.
function formatHourMinute(h: number) {
  const totalMin = Math.round(h * 60);
  const hour24 = Math.floor(totalMin / 60) % 24;
  const minute = totalMin % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

const STRIPE_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(120,120,120,0.35) 0 6px, transparent 6px 12px)",
  backgroundColor: "rgba(120,120,120,0.25)",
};

function DayBg({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`absolute inset-0 ${className ?? ""}`} style={style} />;
}

// Renders the striped "outside working hours" overlay for a single day column.
// Hours inside any working-hours segment are left blank (or washed). Used by
// both the AvailabilityWeekGrid and the schedule-preview's self-only mode.
function workingHoursStripeLayer(
  workingHours: WhDay[],
  dow: number,
  options?: { wash?: boolean },
): React.ReactNode {
  const wh = workingHours.find((w) => w.dayOfWeek === dow);
  if (!wh || wh.segments.length === 0) return <DayBg style={STRIPE_STYLE} />;
  const sorted = wh.segments
    .map((s) => ({ start: s.startMinute / 60, end: s.endMinute / 60 }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
    } else {
      merged.push({ ...s });
    }
  }
  const dayStart = HOURS[0];
  const dayEnd = HOURS[HOURS.length - 1] + 1;
  const stripes: { startHour: number; duration: number }[] = [];
  let cursor = dayStart;
  for (const m of merged) {
    if (m.start > cursor) stripes.push({ startHour: cursor, duration: m.start - cursor });
    cursor = Math.max(cursor, m.end);
  }
  if (cursor < dayEnd) stripes.push({ startHour: cursor, duration: dayEnd - cursor });
  return (
    <>
      {stripes.map((s, i) => (
        <BlockBlock
          key={`stripe-${i}`}
          topHour={dayStart}
          startHour={s.startHour}
          duration={s.duration}
          style={STRIPE_STYLE}
        />
      ))}
      {options?.wash &&
        merged.map((s, i) => (
          <BlockBlock
            key={`wash-${i}`}
            topHour={dayStart}
            startHour={s.start}
            duration={s.end - s.start}
            className="bg-accent-green/20 dark:bg-accent-green/15"
          />
        ))}
    </>
  );
}

function BlockBlock({
  topHour,
  startHour,
  duration,
  className,
  style,
}: {
  topHour: number;
  startHour: number;
  duration: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (duration <= 0) return null;
  return (
    <div
      className={`absolute left-0 right-0 ${className ?? ""}`}
      style={{
        top: (startHour - topHour) * HOUR_PX,
        height: duration * HOUR_PX,
        ...style,
      }}
    />
  );
}

