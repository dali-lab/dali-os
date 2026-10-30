import { useMemo, useState } from "react";
import { Link, useFetcher, useLoaderData, useNavigate } from "react-router";
import { CalendarDays, Coffee, FileText, MapPin, Trophy, UserPen } from "lucide-react";
import type { Route } from "./+types/connect";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { listUpcomingMeetings } from "~/lib/upcoming-meetings";
import { formatInTimeZone, resolveUserTimeZone } from "~/lib/timezone";
import { meetingOccurrenceHref } from "~/calendar/lib/meeting-href";
import { prisma } from "~/lib/db";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { fullName } from "~/lib/display";
import { Avatar } from "~/components/ui/Avatar";
import { Segmented, type SegmentedOption } from "~/components/ui/Segmented";
import { Button } from "~/components/ui/Button";
import { Toggle } from "~/components/ui/Toggle";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { ConnectMap } from "~/members/components/ConnectMap";
import { PlaceList } from "~/members/components/PlaceList";
import { groupByPlace, profileCompleteness, type ConnectAlum } from "~/members/lib/connect";
import { loadAlumniLeaderboard } from "~/members/lib/engagement.server";
import {
  ENGAGEMENT_ACTIVITIES,
  describeCounts,
  type LeaderboardEntry,
} from "~/members/lib/engagement";
import { InfoTip } from "~/components/ui/floating";

export const meta: Route.MetaFunction = ({ data }) => [{ title: `${data?.title ?? "Connect"} · DALI OS` }];

const isFullMap = (data: unknown) => Boolean((data as { fullMap?: boolean } | undefined)?.fullMap);

export const handle = {
  breadcrumb: (data: unknown) => (data as { title?: string } | undefined)?.title ?? "Connect",
  fitViewport: isFullMap,
  bleedPane: isFullMap,
};

// Where DALI alumni are now: one pin per place, from the "Based in" field on
// each alum's profile. Open to current members and alumni alike.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;

  const alumniWhere = { ...LAB_MEMBER_WHERE, membershipStatus: "Alumni" as const };
  const [users, unplaced, me, leaderboard, roles] = await Promise.all([
    prisma.user.findMany({
      where: {
        ...alumniWhere,
        currentLocation: { not: null },
        currentLocationLat: { not: null },
        currentLocationLng: { not: null },
      },
      orderBy: MEMBER_LIST_ORDER_BY,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        photoUrl: true,
        classYear: true,
        currentLocation: true,
        currentLocationLat: true,
        currentLocationLng: true,
        workExperiences: {
          where: { endDate: null },
          orderBy: { startDate: "desc" },
          take: 1,
          select: { position: true, company: true },
        },
      },
    }),
    prisma.user.count({
      where: { ...alumniWhere, OR: [{ currentLocationLat: null }, { currentLocationLng: null }] },
    }),
    prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        photoUrl: true,
        classYear: true,
        currentLocation: true,
        timeZone: true,
        bioDocId: true,
        openToCoffeeChats: true,
        openToResumeReviews: true,
        workExperiences: {
          where: { endDate: null },
          orderBy: { startDate: "desc" },
          take: 1,
          select: { position: true, company: true },
        },
      },
    }),
    loadAlumniLeaderboard(),
    getUserRoles(auth.user.sub, request),
  ]);

  const alumni: ConnectAlum[] = await Promise.all(
    users.map(async (u) => ({
      id: u.id,
      name: fullName(u) || "Alum",
      photoUrl: await resolvePhotoUrl(u.photoUrl),
      classYear: u.classYear,
      location: u.currentLocation!,
      lat: u.currentLocationLat!,
      lng: u.currentLocationLng!,
      currentJob: u.workExperiences[0]
        ? `${u.workExperiences[0].position} at ${u.workExperiences[0].company}`
        : null,
    })),
  );

  // Connect is the alumni Home, where the map fills the page.
  const fullMap = roles.isAlumni;
  const title = fullMap ? "Home" : "Connect";
  const viewer: ViewerCard | null =
    fullMap && me
      ? {
          id: me.id,
          name: fullName(me) || "Alum",
          photoUrl: await resolvePhotoUrl(me.photoUrl),
          classYear: me.classYear,
          location: me.currentLocation,
          currentJob: me.workExperiences[0]
            ? `${me.workExperiences[0].position} at ${me.workExperiences[0].company}`
            : null,
          openTo: { coffeeChats: me.openToCoffeeChats, resumeReviews: me.openToResumeReviews },
          completeness: profileCompleteness({
            photo: Boolean(me.photoUrl),
            job: me.workExperiences.length > 0,
            location: Boolean(me.currentLocation),
            bio: Boolean(me.bioDocId),
            classYear: me.classYear != null,
          }),
        }
      : null;
  const events = fullMap ? await loadUpcomingEvents(auth.user.sub, resolveUserTimeZone(me)) : [];
  return { alumni, unplaced, viewerHasLocation: Boolean(me?.currentLocation), leaderboard, title, fullMap, viewer, events };
}

const OPEN_TO_FIELDS = {
  coffeeChats: "openToCoffeeChats",
  resumeReviews: "openToResumeReviews",
} as const;

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const form = await request.formData();
  if (form.get("intent") !== "open-to") throw new Response("Bad request", { status: 400 });
  const field = OPEN_TO_FIELDS[String(form.get("field")) as keyof typeof OPEN_TO_FIELDS];
  if (!field) throw new Response("Bad request", { status: 400 });
  await prisma.user.update({
    where: { id: auth.user.sub },
    data: { [field]: form.get("value") === "on" },
  });
  return { ok: true };
}

const EVENT_WINDOW_DAYS = 60;
const MAX_EVENTS = 20;

async function loadUpcomingEvents(userId: string, tz: string): Promise<UpcomingEvent[]> {
  const now = new Date();
  const meetings = await listUpcomingMeetings(userId, now, new Date(now.getTime() + EVENT_WINDOW_DAYS * 86_400_000));
  return meetings
    .filter((m) => m.source === "dali")
    .slice(0, MAX_EVENTS)
    .map((m) => ({
      key: `${m.id}:${m.occurrenceStart}`,
      title: m.title,
      month: formatInTimeZone(m.startsAt, tz, { month: "short" }).toUpperCase(),
      day: formatInTimeZone(m.startsAt, tz, { day: "numeric" }),
      time: formatInTimeZone(m.startsAt, tz, { hour: "numeric", minute: "2-digit" }),
      location: m.location,
      going: m.attendeeCount,
      href: meetingOccurrenceHref(m.id, m.occurrenceStart),
    }));
}

export default function Connect() {
  const { alumni, unplaced, viewerHasLocation, leaderboard, title, fullMap, viewer, events } = useLoaderData<typeof loader>();
  const [panel, setPanel] = useState<HomePanel>("search");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const places = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupByPlace(
      q
        ? alumni.filter((a) =>
            [a.name, a.location, a.currentJob ?? "", a.classYear?.toString() ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(q),
          )
        : alumni,
    );
  }, [alumni, query]);

  const selected = places.find((p) => p.key === selectedKey) ?? null;
  const addLocation = !viewerHasLocation && (
    <Link to="/profile" className="text-sm text-os-grey underline-offset-4 hover:text-foreground hover:underline">
      Add where you're based
    </Link>
  );
  const list = (
    <PlaceList
      places={places}
      selected={selected}
      onSelect={setSelectedKey}
      query={query}
      onQueryChange={(q) => {
        setQuery(q);
        setSelectedKey(null);
      }}
      hasAlumni={alumni.length > 0}
    />
  );
  const map = (className: string) => (
    <ConnectMap
      places={places}
      selectedKey={selected?.key ?? null}
      onSelect={setSelectedKey}
      className={className}
    />
  );

  if (fullMap) {
    return (
      <div className="relative min-h-[480px] flex-1">
        <div className="absolute inset-0 isolate">{map("h-full w-full")}</div>
        <aside className="absolute inset-x-3 bottom-3 z-10 flex max-h-[45%] flex-col gap-3 overflow-y-auto rounded-os-card bg-os-card p-4 shadow-xl lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-4 lg:max-h-none lg:w-[400px]">
          <Segmented
            value={panel}
            onChange={setPanel}
            options={HOME_PANELS}
            ariaLabel="Panel"
            fullWidth
            size="md"
            className="shrink-0"
          />
          {panel === "search" && list}
          {panel === "events" && <EventList events={events} />}
          {panel === "leaderboard" && <Leaderboard entries={leaderboard} />}
          {panel === "profile" && viewer && <ViewerProfile viewer={viewer} />}
        </aside>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <h1 className="font-heading text-4xl font-medium text-foreground">{title}</h1>
        {addLocation}
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="overflow-hidden rounded-os-card bg-os-card lg:flex-1">
          {map("h-[420px] w-full lg:h-[calc(100vh-13rem)] lg:min-h-[480px]")}
        </div>

        <aside className="flex flex-col gap-3 rounded-os-card bg-os-card p-4 lg:h-[calc(100vh-13rem)] lg:min-h-[480px] lg:w-[340px]">
          {list}
          {unplaced > 0 && (
            <p className="text-xs text-os-muted">
              {unplaced} more {unplaced === 1 ? "alum has" : "alumni have"} no location yet.
            </p>
          )}
        </aside>
      </div>

      <section className="rounded-os-card bg-os-card p-5">
        <Leaderboard entries={leaderboard} />
      </section>
    </div>
  );
}

type OpenTo = { coffeeChats: boolean; resumeReviews: boolean };

type ViewerCard = Omit<ConnectAlum, "location" | "lat" | "lng"> & {
  location: string | null;
  openTo: OpenTo;
  completeness: ReturnType<typeof profileCompleteness>;
};

type HomePanel = "search" | "events" | "leaderboard" | "profile";

const HOME_PANELS: SegmentedOption<HomePanel>[] = [
  { value: "search", label: "Search" },
  { value: "events", label: "Events" },
  { value: "leaderboard", label: "Leaderboard" },
  { value: "profile", label: "Profile" },
];

type UpcomingEvent = {
  key: string;
  title: string;
  month: string;
  day: string;
  time: string;
  location: string | null;
  going: number;
  href: string;
};

function EventList({ events }: { events: UpcomingEvent[] }) {
  const navigate = useNavigate();
  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-os-muted">No upcoming events.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {events.map((e) => (
        <li key={e.key}>
          <button
            type="button"
            onClick={() => {
              if (!requestOpenTabIfEmbedded(e.href, e.title)) navigate(e.href);
            }}
            className="flex w-full items-center gap-4 rounded-os-item bg-os-container p-3 text-left transition-colors hover:bg-os-hover"
          >
            <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-os-item bg-os-card">
              <span className="text-[11px] font-semibold text-os-grey">{e.month}</span>
              <span className="text-xl font-semibold leading-none text-foreground">{e.day}</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">{e.title}</span>
              <span className="mt-0.5 flex items-center gap-1 text-xs text-os-grey">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{e.location ? `${e.time} · ${e.location}` : e.time}</span>
              </span>
              <span className="mt-0.5 block text-xs text-os-muted">{e.going} going</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const OPEN_TO_ROWS: { key: keyof OpenTo; icon: typeof Coffee; label: string; on: string }[] = [
  { key: "coffeeChats", icon: Coffee, label: "Coffee chats", on: "Students and alumni can invite you" },
  { key: "resumeReviews", icon: FileText, label: "Resume reviews", on: "Students and alumni can ask you" },
];

function OpenToRow({ row, initial }: { row: (typeof OPEN_TO_ROWS)[number]; initial: boolean }) {
  const fetcher = useFetcher();
  const pending = fetcher.formData?.get("value");
  const on = pending != null ? pending === "on" : initial;
  const Icon = row.icon;
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-os-item bg-os-container text-os-grey">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{row.label}</span>
        <span className="block truncate text-xs text-os-grey">{on ? row.on : "Off for now"}</span>
      </span>
      <Toggle
        tone="os"
        checked={on}
        aria-label={row.label}
        onChange={(e) =>
          fetcher.submit(
            { intent: "open-to", field: row.key, value: e.target.checked ? "on" : "off" },
            { method: "post" },
          )
        }
      />
    </div>
  );
}

function ViewerProfile({ viewer }: { viewer: ViewerCard }) {
  const navigate = useNavigate();
  const open = () => {
    if (!requestOpenTabIfEmbedded("/profile", "Profile")) navigate("/profile");
  };
  const { percent, hint } = viewer.completeness;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Avatar photoUrl={viewer.photoUrl} name={viewer.name} size="lg" userId={viewer.id} className="shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground">
            {viewer.name}
            {viewer.classYear && <span className="font-normal text-os-grey"> '{String(viewer.classYear).slice(2)}</span>}
          </p>
          {viewer.currentJob && <p className="truncate text-sm text-os-grey">{viewer.currentJob}</p>}
          {viewer.location && (
            <p className="flex items-center gap-1 truncate text-xs text-os-grey">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {viewer.location}
            </p>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-foreground">I'm open to</h3>
        {OPEN_TO_ROWS.map((row) => (
          <OpenToRow key={row.key} row={row} initial={viewer.openTo[row.key]} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-base font-semibold text-foreground">Your profile</h3>
          <span className="text-sm font-semibold text-os-accent">{percent}%</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-os-container"
          role="progressbar"
          aria-label="Profile complete"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-os-accent" style={{ width: `${percent}%` }} />
        </div>
        {hint && <p className="text-sm text-os-grey">{hint}</p>}
        <Button onClick={open} className="self-start">
          <UserPen className="h-4 w-4" />
          Update profile
        </Button>
      </section>
    </div>
  );
}

function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  const navigate = useNavigate();
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-os-accent/15 text-os-accent">
          <Trophy className="h-[17px] w-[17px]" />
        </span>
        <h2 className="text-[15px] font-bold text-foreground">Most engaged alumni</h2>
        <InfoTip
          content={
            <span className="flex flex-col gap-1">
              <span>Points since graduating:</span>
              {ENGAGEMENT_ACTIVITIES.map((a) => (
                <span key={a.key}>
                  {a.label}: {a.points}
                </span>
              ))}
            </span>
          }
        />
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-os-muted italic">No alumni activity yet.</p>
      ) : (
        <ol>
          {entries.map((e, i) => {
            const url = `/members/${e.id}`;
            return (
              <li key={e.id} className="border-b border-os-container last:border-0">
                <button
                  type="button"
                  onClick={() => {
                    if (!requestOpenTabIfEmbedded(url, e.name)) navigate(url);
                  }}
                  className="flex w-full items-center gap-3 rounded-os-item px-2 py-2.5 text-left transition-colors hover:bg-os-container"
                >
                  <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-os-grey">
                    {i + 1}
                  </span>
                  <Avatar photoUrl={e.photoUrl} name={e.name} size="sm" userId={e.id} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {e.name}
                      {e.classYear && <span className="text-os-grey"> '{String(e.classYear).slice(2)}</span>}
                    </span>
                    <span className="block truncate text-xs text-os-grey">{describeCounts(e.counts)}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {e.score} {e.score === 1 ? "pt" : "pts"}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
