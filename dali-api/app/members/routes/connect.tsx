import { useMemo, useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { MapPin, Trophy, X } from "lucide-react";
import type { Route } from "./+types/connect";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { fullName } from "~/lib/display";
import { cn } from "~/lib/cn";
import { Avatar } from "~/components/ui/Avatar";
import { IconButton } from "~/components/ui/IconButton";
import { SearchInput } from "~/components/ui/SearchInput";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { ConnectMap } from "~/members/components/ConnectMap";
import { groupByPlace, type ConnectAlum } from "~/members/lib/connect";
import { loadAlumniLeaderboard } from "~/members/lib/engagement.server";
import {
  ENGAGEMENT_ACTIVITIES,
  describeCounts,
  type LeaderboardEntry,
} from "~/members/lib/engagement";
import { InfoTip } from "~/components/ui/floating";

export const meta: Route.MetaFunction = () => [{ title: "Connect · DALI OS" }];

export const handle = {
  breadcrumb: () => "Connect",
};

// Where DALI alumni are now: one pin per place, from the "Based in" field on
// each alum's profile. Open to current members and alumni alike.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const alumniWhere = { ...LAB_MEMBER_WHERE, membershipStatus: "Alumni" as const };
  const [users, unplaced, me, leaderboard] = await Promise.all([
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
      select: { currentLocation: true },
    }),
    loadAlumniLeaderboard(),
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

  return { alumni, unplaced, viewerHasLocation: Boolean(me?.currentLocation), leaderboard };
}

export default function Connect() {
  const { alumni, unplaced, viewerHasLocation, leaderboard } = useLoaderData<typeof loader>();
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
  const shown = selected ? [selected] : places;
  const count = places.reduce((n, p) => n + p.alumni.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <h1 className="font-heading text-4xl font-medium text-foreground">Connect</h1>
        {!viewerHasLocation && (
          <Link to="/profile" className="text-sm text-os-grey underline-offset-4 hover:text-foreground hover:underline">
            Add where you're based
          </Link>
        )}
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="overflow-hidden rounded-os-card bg-os-card lg:flex-1">
          <ConnectMap
            places={places}
            selectedKey={selected?.key ?? null}
            onSelect={setSelectedKey}
            className="h-[420px] w-full lg:h-[calc(100vh-13rem)] lg:min-h-[480px]"
          />
        </div>

        <aside className="flex flex-col gap-3 rounded-os-card bg-os-card p-4 lg:h-[calc(100vh-13rem)] lg:min-h-[480px] lg:w-[340px]">
          <SearchInput
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedKey(null);
            }}
            placeholder="Search by name, place or company"
          />
          <div className="flex items-center justify-between gap-2 text-xs text-os-grey">
            {selected ? (
              <>
                <span className="truncate font-semibold text-foreground">{selected.label}</span>
                <IconButton label="Show all places" icon={X} onClick={() => setSelectedKey(null)} />
              </>
            ) : (
              <span>
                {count} {count === 1 ? "alum" : "alumni"} in {places.length}{" "}
                {places.length === 1 ? "place" : "places"}
              </span>
            )}
          </div>

          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            {places.length === 0 ? (
              <p className="py-6 text-center text-sm text-os-muted">
                {alumni.length === 0 ? "No alumni on the map yet." : "No alumni match."}
              </p>
            ) : (
              shown.map((p) => (
                <section key={p.key} className="mb-3 last:mb-0">
                  {!selected && (
                    <button
                      type="button"
                      onClick={() => setSelectedKey(p.key)}
                      className="flex w-full items-center gap-1.5 py-1.5 text-left text-xs font-semibold text-os-grey hover:text-foreground"
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{p.label}</span>
                      <span className="ml-auto text-os-muted">{p.alumni.length}</span>
                    </button>
                  )}
                  {p.alumni.map((a) => (
                    <AlumRow key={a.id} alum={a} />
                  ))}
                </section>
              ))
            )}
          </div>

          {unplaced > 0 && (
            <p className="text-xs text-os-muted">
              {unplaced} more {unplaced === 1 ? "alum has" : "alumni have"} no location yet.
            </p>
          )}
        </aside>
      </div>

      <Leaderboard entries={leaderboard} />
    </div>
  );
}

function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  const navigate = useNavigate();
  return (
    <section className="rounded-os-card bg-os-card p-5">
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
    </section>
  );
}

function AlumRow({ alum }: { alum: ConnectAlum }) {
  const navigate = useNavigate();
  const url = `/members/${alum.id}`;
  return (
    <button
      type="button"
      onClick={() => {
        if (!requestOpenTabIfEmbedded(url, alum.name)) navigate(url);
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-os-item px-2 py-2 text-left transition-colors hover:bg-os-container",
      )}
    >
      <Avatar photoUrl={alum.photoUrl} name={alum.name} size="sm" userId={alum.id} className="shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">
          {alum.name}
          {alum.classYear && <span className="text-os-grey"> '{String(alum.classYear).slice(2)}</span>}
        </span>
        {alum.currentJob && (
          <span className="block truncate text-xs text-os-grey">{alum.currentJob}</span>
        )}
      </span>
    </button>
  );
}
