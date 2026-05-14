import { redirect, useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
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
  ChevronDown,
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

type WhDay = {
  dayOfWeek: number;
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  location: "InPerson" | "Remote";
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
};

function defaultWorkingHours(): WhDay[] {
  // Mon–Fri 9–5 InPerson, weekends disabled.
  return Array.from({ length: 7 }).map((_, dow) => ({
    dayOfWeek: dow,
    enabled: dow >= 1 && dow <= 5,
    startMinute: DEFAULT_WORK_START_MIN,
    endMinute: DEFAULT_WORK_END_MIN,
    location: "InPerson",
  }));
}

// Window for the visible week grid. We compute Sunday→following Sunday in the
// user's timezone (the grid renders Sun..Sat columns).
function currentWeekWindow(timezone: string): { start: Date; end: Date } {
  const now = new Date();
  const ymd = getZonedYMD(now, timezone);
  const todayUtcMidnight = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  const dow = todayUtcMidnight.getUTCDay();
  const sundayUtc = new Date(todayUtcMidnight.getTime() - dow * 86_400_000);
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

  const [settings, whRows, blocks, links] = await Promise.all([
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
  ]);

  const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
  const bufferMin = settings?.defaultEventBufferMin ?? DEFAULT_BUFFER_MIN;

  const byDow = new Map(whRows.map((r) => [r.dayOfWeek, r]));
  const workingHours: WhDay[] = defaultWorkingHours().map((d) => {
    const row = byDow.get(d.dayOfWeek);
    if (!row) return d;
    return {
      dayOfWeek: row.dayOfWeek,
      enabled: row.enabled,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      location: row.location,
    };
  });

  const { start: weekStart, end: weekEnd } = currentWeekWindow(timezone);

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

  const { busy } = computeFreeIntervals({
    windowStart: weekStart,
    windowEnd: weekEnd,
    workingHours,
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
    case "update-working-hours-day": {
      if (input.enabled && input.startMinute >= input.endMinute) {
        return Response.json({ error: "startMinute must be < endMinute" }, { status: 400 });
      }
      await prisma.workingHoursDay.upsert({
        where: { userId_dayOfWeek: { userId, dayOfWeek: input.dayOfWeek } },
        create: {
          userId,
          dayOfWeek: input.dayOfWeek,
          enabled: input.enabled,
          startMinute: input.startMinute,
          endMinute: input.endMinute,
          location: input.location,
        },
        update: {
          enabled: input.enabled,
          startMinute: input.startMinute,
          endMinute: input.endMinute,
          location: input.location,
        },
      });
      return null;
    }

    case "copy-weekdays": {
      const monday = await prisma.workingHoursDay.findUnique({
        where: { userId_dayOfWeek: { userId, dayOfWeek: 1 } },
      });
      if (!monday) return null;
      const tuesToFri = [2, 3, 4, 5];
      await Promise.all(
        tuesToFri.map((dow) =>
          prisma.workingHoursDay.upsert({
            where: { userId_dayOfWeek: { userId, dayOfWeek: dow } },
            create: {
              userId,
              dayOfWeek: dow,
              enabled: monday.enabled,
              startMinute: monday.startMinute,
              endMinute: monday.endMinute,
              location: monday.location,
            },
            update: {
              enabled: monday.enabled,
              startMinute: monday.startMinute,
              endMinute: monday.endMinute,
              location: monday.location,
            },
          }),
        ),
      );
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
    case "update-working-hours-day":
      return {
        intent,
        dayOfWeek: asInt(get("dayOfWeek")),
        enabled: asBool(get("enabled")),
        startMinute: asInt(get("startMinute")),
        endMinute: asInt(get("endMinute")),
        location: get("location"),
      };
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

      {tab === "availability" ? <AvailabilityView data={data} /> : <ScheduleView />}
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
  return (
    // lg:h-[80vh] caps the row so the aside can scroll while the grid stays put.
    // Below lg we fall back to single-column natural flow.
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 lg:h-[80vh] lg:min-h-0">
      <aside className="flex flex-col gap-6 lg:overflow-y-auto lg:pr-2 lg:min-h-0">
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

function DayRow({ day }: { day: WhDay }) {
  const fetcher = useFetcher();
  // Optimistic state: while a submit is pending, render the in-flight values
  // rather than the stale loader values so toggles feel instant.
  const pending = fetcher.formData;
  const enabled = pending ? pending.get("enabled") === "true" : day.enabled;
  const startMinute = pending ? Number(pending.get("startMinute")) : day.startMinute;
  const endMinute = pending ? Number(pending.get("endMinute")) : day.endMinute;
  const location =
    (pending ? (pending.get("location") as string) : day.location) === "Remote" ? "Remote" : "InPerson";

  const submit = (partial: { enabled?: boolean; startMinute?: number; endMinute?: number; location?: "InPerson" | "Remote" }) => {
    const next = {
      enabled: partial.enabled ?? enabled,
      startMinute: partial.startMinute ?? startMinute,
      endMinute: partial.endMinute ?? endMinute,
      location: partial.location ?? location,
    };
    fetcher.submit(
      {
        intent: "update-working-hours-day",
        dayOfWeek: String(day.dayOfWeek),
        enabled: String(next.enabled),
        startMinute: String(next.startMinute),
        endMinute: String(next.endMinute),
        location: next.location,
      },
      { method: "post" },
    );
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => submit({ enabled: !enabled })}
        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
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
      <span className="text-sm font-medium text-foreground w-9">{DAY_LABELS[day.dayOfWeek]}</span>
      {enabled ? (
        <>
          <TimeField
            valueMin={startMinute}
            onCommit={(min) => submit({ startMinute: min })}
            aria-label={`${DAY_LABELS[day.dayOfWeek]} start time`}
          />
          <span className="text-muted-foreground text-sm">–</span>
          <TimeField
            valueMin={endMinute}
            onCommit={(min) => submit({ endMinute: min })}
            aria-label={`${DAY_LABELS[day.dayOfWeek]} end time`}
          />
          <div className="flex items-center gap-0.5 ml-auto">
            <LocButton
              active={location === "InPerson"}
              onClick={() => submit({ location: "InPerson" })}
              icon={<Building2 className="w-3.5 h-3.5" />}
            />
            <LocButton
              active={location === "Remote"}
              onClick={() => submit({ location: "Remote" })}
              icon={<Wifi className="w-3.5 h-3.5" />}
            />
          </div>
        </>
      ) : (
        <span className="text-sm text-muted-foreground italic ml-1">Unavailable</span>
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

function WeekToolbar({ legend, monthLabel }: { legend: { color: string; label: string }[]; monthLabel: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-lg font-bold text-foreground">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous week" disabled className="p-1.5 rounded-md text-muted-foreground/40">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" className="px-3 py-1 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors">
            Today
          </button>
          <button type="button" aria-label="Next week" disabled className="p-1.5 rounded-md text-muted-foreground/40">
            <ChevronRight className="w-4 h-4" />
          </button>
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

function AvailabilityWeekGrid({ data }: { data: LoaderData }) {
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
        legend={[
          { color: "bg-accent-green", label: "Available" },
          { color: "bg-muted", label: "Outside Hours" },
          { color: "bg-accent-coral", label: "Busy" },
        ]}
      />
      <WeekGrid
        days={days}
        showProviderRow
        backgroundLayer={(dayIdx) => {
          const dow = days[dayIdx].dayOfWeek;
          const wh = data.workingHours.find((w) => w.dayOfWeek === dow);
          if (!wh || !wh.enabled) return <DayBg style={STRIPE_STYLE} />;
          const startH = wh.startMinute / 60;
          const endH = wh.endMinute / 60;
          return (
            <>
              {/* before working hours */}
              <BlockBlock topHour={HOURS[0]} startHour={HOURS[0]} duration={Math.max(0, startH - HOURS[0])} style={STRIPE_STYLE} />
              {/* after working hours */}
              <BlockBlock topHour={HOURS[0]} startHour={endH} duration={Math.max(0, HOURS[HOURS.length - 1] + 1 - endH)} style={STRIPE_STYLE} />
              {/* working hours wash */}
              <BlockBlock topHour={HOURS[0]} startHour={startH} duration={endH - startH} className="bg-accent-green/20 dark:bg-accent-green/15" />
            </>
          );
        }}
        eventsByDay={eventsByDay}
      />
    </section>
  );
}

// Hard-coded dark text that doesn't flip in dark mode (the dark-blue token does).
const EVENT_TEXT = "text-[hsl(203_38%_18%)]";
const EVENT_CORAL = `bg-accent-coral-light ${EVENT_TEXT}`;
const MATCH_CLS = `bg-accent-coral-light ${EVENT_TEXT}`;
const NEAR_MISS_CLS = `bg-accent-green ${EVENT_TEXT}`;

/* ------------------------------------------------------------------ */
/* Schedule view (Phase 3 will wire to a backend search)               */
/* ------------------------------------------------------------------ */

type PersonRow = { id: string; label: string };
type GroupRow = { id: string; mode: "ALL" | "ANY" | "ATLEAST"; n: number; people: PersonRow[] };

function ScheduleView() {
  const [outer, setOuter] = useState<{ mode: "ALL" | "ANY"; rows: (PersonRow | GroupRow)[] }>({
    mode: "ALL",
    rows: [
      { id: "p1", label: "Carol (PM)" },
      {
        id: "g1",
        mode: "ATLEAST",
        n: 1,
        people: [
          { id: "p2", label: "Bob (Developer)" },
          { id: "p3", label: "Dave (Developer)" },
        ],
      },
    ],
  });

  const addPersonToOuter = () =>
    setOuter((s) => ({ ...s, rows: [...s.rows, { id: rid(), label: "New person" }] }));
  const addGroupToOuter = () =>
    setOuter((s) => ({ ...s, rows: [...s.rows, { id: rid(), mode: "ATLEAST", n: 1, people: [] }] }));
  const removeOuterRow = (id: string) =>
    setOuter((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== id) }));
  const addPersonToGroup = (groupId: string) =>
    setOuter((s) => ({
      ...s,
      rows: s.rows.map((r) =>
        "people" in r && r.id === groupId ? { ...r, people: [...r.people, { id: rid(), label: "New person" }] } : r,
      ),
    }));
  const removePersonFromGroup = (groupId: string, personId: string) =>
    setOuter((s) => ({
      ...s,
      rows: s.rows.map((r) =>
        "people" in r && r.id === groupId ? { ...r, people: r.people.filter((p) => p.id !== personId) } : r,
      ),
    }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 lg:h-[80vh] lg:min-h-0">
      <aside className="flex flex-col gap-4 lg:overflow-y-auto lg:pr-2 lg:min-h-0">
        <header>
          <h1 className="font-heading text-2xl font-bold text-foreground">Schedule Meeting</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build complex availability rules to find the perfect time.
          </p>
        </header>
        <div>
          <h2 className="font-heading font-semibold text-foreground mb-3">Who needs to be there?</h2>
          <div className="bg-card border border-border border-l-4 border-l-accent-coral rounded-md p-3 flex flex-col gap-2">
            <ModeDropdown
              value={outer.mode === "ALL" ? "ALL of these (AND)" : "ANY of these (OR)"}
            />
            {outer.rows.map((row) =>
              "people" in row ? (
                <GroupRowView
                  key={row.id}
                  row={row}
                  onRemove={() => removeOuterRow(row.id)}
                  onAddPerson={() => addPersonToGroup(row.id)}
                  onRemovePerson={(pid) => removePersonFromGroup(row.id, pid)}
                />
              ) : (
                <PersonRowView key={row.id} label={row.label} onRemove={() => removeOuterRow(row.id)} />
              ),
            )}
            <div className="flex items-center gap-2 pt-1">
              <AddBtn label="Add Person" onClick={addPersonToOuter} />
              <AddBtn label="Add Group" onClick={addGroupToOuter} />
            </div>
          </div>
        </div>
      </aside>
      <div className="lg:overflow-hidden lg:min-h-0">
        <ScheduleWeekGrid />
      </div>
    </div>
  );
}

function rid() {
  return Math.random().toString(36).slice(2, 9);
}

function ModeDropdown({ value }: { value: string }) {
  return (
    <button
      type="button"
      className="w-fit inline-flex items-center justify-between gap-2 px-3 py-1.5 text-sm font-medium border border-border rounded-md bg-background hover:bg-muted transition-colors"
    >
      <span>{value}</span>
      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
    </button>
  );
}

function PersonRowView({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="flex-1 inline-flex items-center justify-between gap-2 px-3 py-1.5 text-sm font-medium border border-border rounded-md bg-background hover:bg-muted transition-colors"
      >
        <span>{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function GroupRowView({
  row,
  onRemove,
  onAddPerson,
  onRemovePerson,
}: {
  row: GroupRow;
  onRemove: () => void;
  onAddPerson: () => void;
  onRemovePerson: (id: string) => void;
}) {
  return (
    <div className="border-l-2 border-accent-coral pl-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center justify-between gap-2 px-2.5 py-1 text-xs font-medium border border-border rounded-md bg-background hover:bg-muted transition-colors"
        >
          <span>AT LEAST N of these</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
        <input
          type="number"
          defaultValue={row.n}
          min={1}
          className="w-12 px-2 py-1 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        <span className="text-xs text-muted-foreground">people</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove group"
          className="ml-auto p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {row.people.map((p) => (
        <PersonRowView key={p.id} label={p.label} onRemove={() => onRemovePerson(p.id)} />
      ))}
      <div className="flex items-center gap-2 pt-0.5">
        <AddBtn label="Add Person" onClick={onAddPerson} size="sm" />
        <AddBtn label="Add Group" onClick={() => {}} size="sm" />
      </div>
    </div>
  );
}

function AddBtn({ label, onClick, size = "md" }: { label: string; onClick: () => void; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border border-border text-foreground hover:bg-muted transition-colors ${
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs font-medium"
      }`}
    >
      <Plus className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
      {label}
    </button>
  );
}

function ScheduleWeekGrid() {
  // Phase 3 will replace this with a real /api/calendar/search result.
  const placeholderDays = Array.from({ length: 7 }).map((_, i) => ({ dayOfWeek: i, num: 10 + i, dateUtc: new Date() }));
  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col">
      <WeekToolbar
        monthLabel="(Schedule preview)"
        legend={[
          { color: "bg-accent-coral", label: "Match" },
          { color: "bg-accent-green", label: "Near Miss" },
        ]}
      />
      <WeekGrid days={placeholderDays} eventsByDay={schedulePlaceholder} />
    </section>
  );
}

const schedulePlaceholder: Record<number, EventBlock[]> = {
  2: [
    { startHour: 9, duration: 1.5, label: "~50% match", className: NEAR_MISS_CLS, borderClassName: "border-accent-green" },
    { startHour: 10.5, duration: 1, label: "✓ Available", className: MATCH_CLS },
  ],
  3: [{ startHour: 9, duration: 2.5, label: "~50% match", className: NEAR_MISS_CLS, borderClassName: "border-accent-green" }],
};

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
  showProviderRow = false,
}: {
  days: { dayOfWeek: number; num: number; dateUtc: Date }[];
  eventsByDay: Record<number, EventBlock[]>;
  backgroundLayer?: (dayIdx: number) => React.ReactNode;
  showProviderRow?: boolean;
}) {
  return (
    <div className="flex border border-border rounded-md overflow-hidden">
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
          <div className="relative" style={{ height: HOURS.length * HOUR_PX }}>
            {HOURS.map((_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-t border-border/60"
                style={{ top: i * HOUR_PX }}
              />
            ))}
            {backgroundLayer?.(idx)}
            {(eventsByDay[idx] ?? []).map((e, i) => {
              const bufferBefore = e.bufferBefore ?? 0;
              const bufferAfter = e.bufferAfter ?? 0;
              const totalHours = bufferBefore + e.duration + bufferAfter;
              const border = e.borderClassName ?? "border-accent-coral-light";
              const bufferBg = e.bufferClassName ?? "";
              return (
                <div
                  key={i}
                  className={`absolute left-0 right-0 border-2 ${border} ${bufferBg} overflow-hidden`}
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

const STRIPE_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(120,120,120,0.35) 0 6px, transparent 6px 12px)",
  backgroundColor: "rgba(120,120,120,0.25)",
};

function DayBg({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`absolute inset-0 ${className ?? ""}`} style={style} />;
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

