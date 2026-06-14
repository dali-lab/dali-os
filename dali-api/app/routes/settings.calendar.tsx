// Settings → Calendar. Mirrors the integrations card from /calendar so that
// linking, removing, and selecting which Google sub-calendars block availability
// can be managed from one canonical place. The richer working-hours / buffers /
// manual-blocks editors stay on /calendar where they sit next to the live grid.

import { Link, redirect, useFetcher } from "react-router";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { requireAuth, forbidden, unauthorized } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { listCalendarsForLink } from "~/lib/google-calendar";
import { CalendarActionSchema } from "~/lib/calendar-schemas";
import type { Route } from "./+types/settings.calendar";

export const meta: Route.MetaFunction = () => [{ title: "Calendar · Settings · DALI OS" }];

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
  syncError: string | null;
  subCalendars: SubCalendarDTO[] | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const links = await prisma.userCalendarLink.findMany({
    where: { userId: auth.user.sub },
    orderBy: { linkedAt: "asc" },
  });

  const calendarLinks: CalendarLinkDTO[] = await Promise.all(
    links.map(async (l) => {
      const base = {
        id: l.id,
        provider: l.provider,
        externalEmail: l.externalEmail,
        displayName: l.displayName,
        syncError: l.syncError,
      };
      if (l.provider !== "Google") return { ...base, subCalendars: null };
      try {
        const items = await listCalendarsForLink(l.id);
        const enabledSet = new Set(l.subCalendarIds);
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
  );

  return { calendarLinks };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  if (auth.user.type === "applicant")
    return forbidden(request);

  const userId = auth.user.sub;
  const form = await request.formData();
  const raw = Object.fromEntries(form.entries());
  const intent = typeof raw.intent === "string" ? raw.intent : "";

  // Only two intents are reachable from this page; the schema rejects others.
  const candidate =
    intent === "toggle-sub-calendar"
      ? {
          intent,
          linkId: String(raw.linkId ?? ""),
          calendarId: String(raw.calendarId ?? ""),
          enabled: raw.enabled === "true",
        }
      : { intent, linkId: String(raw.linkId ?? "") };

  const parsed = CalendarActionSchema.safeParse(candidate);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  if (input.intent === "remove-calendar-link") {
    const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
    if (!link || link.userId !== userId) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.userCalendarLink.delete({ where: { id: input.linkId } });
    return null;
  }

  if (input.intent === "toggle-sub-calendar") {
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

  return Response.json({ error: "Unsupported intent" }, { status: 400 });
}

export default function SettingsCalendarPage({ loaderData }: Route.ComponentProps) {
  const { calendarLinks } = loaderData;
  return (
    <main className="max-w-3xl p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Link Google accounts so DALI OS can see when you're busy and
            schedule meetings on calendars you select. Working hours, event
            buffers, and manual blocks live on the{" "}
            <Link to="/calendar" className="text-blue-700 underline">
              Calendar page
            </Link>{" "}
            next to the availability grid.{" "}
            <Link to="/help/calendar" className="text-blue-700 underline">
              How calendar sync works
            </Link>
            .
          </p>
        </div>
        <a
          href="/oauth/calendar/google/start"
          target="_top"
          rel="noopener"
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold hover:bg-zinc-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add Google account
        </a>
      </header>

      <section className="mt-6">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <CalendarDays className="h-4 w-4" /> Linked accounts
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          {calendarLinks.length === 0 && (
            <div className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
              No external calendars connected. Click{" "}
              <em>Add Google account</em> above to link one.
            </div>
          )}
          {calendarLinks.map((l) => (
            <CalendarLinkBlock key={l.id} link={l} />
          ))}
        </div>
      </section>
    </main>
  );
}

function CalendarLinkBlock({ link }: { link: CalendarLinkDTO }) {
  const removeFetcher = useFetcher();
  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 border-l-4 border-l-teal-500 bg-white">
      <div className="flex items-center justify-between bg-teal-500/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <GoogleIcon />
          <span className="truncate text-sm font-semibold text-zinc-900">
            {link.displayName ?? link.externalEmail}
          </span>
        </div>
        <removeFetcher.Form method="post">
          <input type="hidden" name="intent" value="remove-calendar-link" />
          <input type="hidden" name="linkId" value={link.id} />
          <button
            type="submit"
            aria-label={`Remove ${link.externalEmail}`}
            className="rounded-md p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </removeFetcher.Form>
      </div>
      <div className="flex flex-col gap-2 px-3 py-3">
        {link.syncError && (
          <div className="text-[11px] text-red-700">
            Sync error: {link.syncError}
          </div>
        )}
        <p className="text-xs text-zinc-600">
          Select which calendars should block your availability:
        </p>
        {link.subCalendars === null ? (
          <div className="text-xs italic text-zinc-500">
            Couldn't load this account's calendars.
          </div>
        ) : link.subCalendars.length === 0 ? (
          <div className="text-xs italic text-zinc-500">No calendars found.</div>
        ) : (
          link.subCalendars.map((cal) => (
            <SubCalendarRow key={cal.id} linkId={link.id} cal={cal} />
          ))
        )}
      </div>
    </div>
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
      className="flex items-center justify-between rounded-md px-1 py-1 text-left transition-colors hover:bg-zinc-50"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ backgroundColor: cal.color ?? "#9ca3af" }}
        />
        <span className="truncate text-sm text-zinc-900">{cal.summary}</span>
        {cal.primary && (
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">
            Primary
          </span>
        )}
      </div>
      <span
        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-colors ${
          enabled
            ? "border-teal-600 bg-teal-600 text-white"
            : "border-zinc-300 bg-white"
        }`}
      >
        {enabled && (
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        )}
      </span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
