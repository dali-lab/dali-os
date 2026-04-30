import { useMemo, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console.party";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { Sparkles } from "lucide-react";

export const meta: Route.MetaFunction = () => [
  { title: "Party · Admin console · DALI OS" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

const EVENT_TYPES = [
  "PARTY_VISIT",
  "CODE_UNLOCK_SUCCESS",
  "CODE_UNLOCK_FAILURE",
  "DINO_REWARD_EARNED",
  "LOGO_TRAIL_TRIGGERED",
] as const;
type EventType = (typeof EVENT_TYPES)[number];

const EVENT_COLORS: Record<EventType, string> = {
  PARTY_VISIT: "bg-accent-coral/70",
  CODE_UNLOCK_SUCCESS: "bg-emerald-500/70",
  CODE_UNLOCK_FAILURE: "bg-rose-500/70",
  DINO_REWARD_EARNED: "bg-amber-500/70",
  LOGO_TRAIL_TRIGGERED: "bg-sky-500/70",
};

const EVENT_LABELS: Record<EventType, string> = {
  PARTY_VISIT: "Visit",
  CODE_UNLOCK_SUCCESS: "Unlock ✓",
  CODE_UNLOCK_FAILURE: "Unlock ✗",
  DINO_REWARD_EARNED: "Dino reward",
  LOGO_TRAIL_TRIGGERED: "Logo trail",
};

const RECENT_DEFAULT_LIMIT = 50;
const RECENT_MAX_LIMIT = 200;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  if (!(await isAdmin(auth.user.sub))) return withAuth(auth, redirect("/admin-console/members"));

  const url = new URL(request.url);
  const recentLimit = Math.min(
    Math.max(Number(url.searchParams.get("recentLimit") ?? RECENT_DEFAULT_LIMIT) || RECENT_DEFAULT_LIMIT, 1),
    RECENT_MAX_LIMIT,
  );
  const recentOffset = Math.max(Number(url.searchParams.get("recentOffset") ?? 0) || 0, 0);

  const since = new Date(Date.now() - 30 * DAY_MS);

  const [
    byEventType,
    byEventTypeAudience,
    uniqueVisitors,
    recentByDay,
    perUserRollup,
    audienceMap,
    recentEntries,
    recentTotal,
  ] = await Promise.all([
    prisma.partyEvent.groupBy({
      by: ["eventType"],
      _count: { _all: true },
    }),
    prisma.partyEvent.groupBy({
      by: ["eventType", "audience"],
      _count: { _all: true },
    }),
    prisma.partyEvent.findMany({
      where: { eventType: "PARTY_VISIT" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.partyEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { eventType: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.partyEvent.groupBy({
      by: ["userId", "eventType"],
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.partyEvent.groupBy({
      by: ["userId", "audience"],
      _count: { _all: true },
    }),
    prisma.partyEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: recentLimit,
      skip: recentOffset,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            daliEmail: true,
            dartmouthEmail: true,
          },
        },
      },
    }),
    prisma.partyEvent.count(),
  ]);

  const totals = Object.fromEntries(
    byEventType.map((row) => [row.eventType, row._count._all]),
  ) as Record<string, number>;

  const unlocksByAudience = {
    member: { success: 0, failure: 0 },
    applicant: { success: 0, failure: 0 },
  };
  for (const row of byEventTypeAudience) {
    if (row.eventType === "CODE_UNLOCK_SUCCESS") {
      unlocksByAudience[row.audience].success = row._count._all;
    } else if (row.eventType === "CODE_UNLOCK_FAILURE") {
      unlocksByAudience[row.audience].failure = row._count._all;
    }
  }

  const dayBuckets = new Map<string, Partial<Record<EventType, number>>>();
  for (const row of recentByDay) {
    const key = row.createdAt.toISOString().slice(0, 10);
    const bucket = dayBuckets.get(key) ?? {};
    const t = row.eventType as EventType;
    bucket[t] = (bucket[t] ?? 0) + 1;
    dayBuckets.set(key, bucket);
  }
  const timeline = Array.from(dayBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, counts]) => ({
      day,
      counts: counts as Partial<Record<EventType, number>>,
      total: EVENT_TYPES.reduce((sum, t) => sum + (counts[t] ?? 0), 0),
    }));

  const userIds = Array.from(
    new Set(
      perUserRollup
        .map((r) => r.userId)
        .filter((id): id is string => typeof id === "string"),
    ),
  );
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          daliEmail: true,
          dartmouthEmail: true,
        },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  type PerUserRow = {
    userId: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    audiences: ("member" | "applicant")[];
    counts: Record<EventType, number>;
    total: number;
    lastSeen: string | null;
  };

  const perUserMap = new Map<string, PerUserRow>();
  const audiencesByUser = new Map<string, Set<"member" | "applicant">>();
  for (const row of audienceMap) {
    const key = row.userId ?? "__null__";
    const set = audiencesByUser.get(key) ?? new Set();
    set.add(row.audience);
    audiencesByUser.set(key, set);
  }

  for (const row of perUserRollup) {
    const key = row.userId ?? "__null__";
    const user = row.userId ? userById.get(row.userId) ?? null : null;
    let entry = perUserMap.get(key);
    if (!entry) {
      entry = {
        userId: row.userId,
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
        email: user?.daliEmail ?? user?.dartmouthEmail ?? null,
        audiences: Array.from(audiencesByUser.get(key) ?? []),
        counts: {
          PARTY_VISIT: 0,
          CODE_UNLOCK_SUCCESS: 0,
          CODE_UNLOCK_FAILURE: 0,
          DINO_REWARD_EARNED: 0,
          LOGO_TRAIL_TRIGGERED: 0,
        },
        total: 0,
        lastSeen: null,
      };
      perUserMap.set(key, entry);
    }
    const t = row.eventType as EventType;
    entry.counts[t] = (entry.counts[t] ?? 0) + row._count._all;
    entry.total += row._count._all;
    const max = row._max.createdAt ? row._max.createdAt.toISOString() : null;
    if (max && (!entry.lastSeen || max > entry.lastSeen)) entry.lastSeen = max;
  }
  const perUser = Array.from(perUserMap.values()).sort(
    (a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""),
  );

  const recent = recentEntries.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    eventType: r.eventType as EventType,
    audience: r.audience,
    metadata: r.metadata,
    user: r.user
      ? {
          id: r.user.id,
          firstName: r.user.firstName,
          lastName: r.user.lastName,
          email: r.user.daliEmail ?? r.user.dartmouthEmail ?? null,
        }
      : null,
  }));

  return withAuth(auth, {
    totals,
    uniqueVisitors: uniqueVisitors.filter((v) => v.userId !== null).length,
    unlocksByAudience,
    timeline,
    perUser,
    recent: {
      entries: recent,
      total: recentTotal,
      limit: recentLimit,
      offset: recentOffset,
    },
  });
}

type SortKey = "lastSeen" | "total";

function displayName(
  row: { firstName: string | null; lastName: string | null; email: string | null; userId: string | null },
): string {
  if (row.userId === null) return "(deleted user)";
  const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
  return name || row.email || "(unknown)";
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export default function AdminConsoleParty() {
  const { totals, uniqueVisitors, unlocksByAudience, timeline, perUser, recent } =
    useLoaderData<typeof loader>();

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("lastSeen");

  const cards: { label: string; value: number }[] = [
    { label: "Total visits", value: totals.PARTY_VISIT ?? 0 },
    { label: "Unique visitors", value: uniqueVisitors },
    { label: "Code unlocks", value: totals.CODE_UNLOCK_SUCCESS ?? 0 },
    { label: "Unlock failures", value: totals.CODE_UNLOCK_FAILURE ?? 0 },
    { label: "Dino rewards earned", value: totals.DINO_REWARD_EARNED ?? 0 },
    { label: "Logo trail triggers", value: totals.LOGO_TRAIL_TRIGGERED ?? 0 },
  ];

  const maxDay = timeline.reduce((m, b) => Math.max(m, b.total), 0);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? perUser.filter((row) => {
          const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.toLowerCase();
          const email = (row.email ?? "").toLowerCase();
          return name.includes(q) || email.includes(q);
        })
      : perUser;
    const sorted = [...rows];
    if (sortBy === "total") {
      sorted.sort((a, b) => b.total - a.total);
    } else {
      sorted.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
    }
    return sorted;
  }, [perUser, search, sortBy]);

  const recentStart = recent.total === 0 ? 0 : recent.offset + 1;
  const recentEnd = Math.min(recent.offset + recent.limit, recent.total);
  const hasPrev = recent.offset > 0;
  const hasNext = recent.offset + recent.limit < recent.total;
  const prevOffset = Math.max(recent.offset - recent.limit, 0);
  const nextOffset = recent.offset + recent.limit;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Sparkles className="w-6 h-6 text-foreground/80" />
        <h1 className="text-2xl font-bold text-foreground">Party Analytics</h1>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          launch-party telemetry
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="bg-card border border-border rounded-lg p-4"
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              {c.label}
            </p>
            <p className="text-2xl font-mono font-semibold text-foreground">
              {c.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">
          Unlocks by audience
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 font-medium">Audience</th>
              <th className="text-right py-2 font-medium">Success</th>
              <th className="text-right py-2 font-medium">Failure</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(["member", "applicant"] as const).map((aud) => (
              <tr key={aud}>
                <td className="py-2 capitalize">{aud}</td>
                <td className="py-2 text-right font-mono">
                  {unlocksByAudience[aud].success.toLocaleString()}
                </td>
                <td className="py-2 text-right font-mono">
                  {unlocksByAudience[aud].failure.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            Daily volume (last 30 days)
          </h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {EVENT_TYPES.map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span className={`inline-block w-2.5 h-2.5 rounded-sm ${EVENT_COLORS[t]}`} />
                {EVENT_LABELS[t]}
              </span>
            ))}
          </div>
        </div>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded yet.</p>
        ) : (
          <div className="space-y-1">
            {timeline.map(({ day, counts, total }) => (
              <div key={day} className="flex items-center gap-3 text-xs">
                <span className="w-20 font-mono text-muted-foreground">{day}</span>
                <div className="flex-1 bg-muted/40 rounded h-3 overflow-hidden flex">
                  {EVENT_TYPES.map((t) => {
                    const v = counts[t] ?? 0;
                    if (v === 0) return null;
                    const pct = maxDay > 0 ? (v / maxDay) * 100 : 0;
                    return (
                      <div
                        key={t}
                        className={`h-full ${EVENT_COLORS[t]}`}
                        style={{ width: `${pct}%` }}
                        title={`${EVENT_LABELS[t]}: ${v}`}
                      />
                    );
                  })}
                </div>
                <span className="w-10 text-right font-mono text-foreground">
                  {total}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-foreground">Per-user activity</h2>
          <div className="flex items-center gap-3">
            <div role="group" aria-label="Sort users" className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["lastSeen", "total"] as SortKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setSortBy(k)}
                  aria-pressed={sortBy === k}
                  className={`px-3 py-1.5 font-medium transition-colors ${
                    sortBy === k
                      ? "bg-gray-900 text-white"
                      : "bg-card text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {k === "lastSeen" ? "Last seen" : "Total events"}
                </button>
              ))}
            </div>
            <label htmlFor="party-user-search" className="sr-only">
              Search users by name or email
            </label>
            <input
              id="party-user-search"
              type="text"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 font-medium">User</th>
                <th className="text-left py-2 font-medium">Audience</th>
                <th className="text-right py-2 font-medium">Visits</th>
                <th className="text-right py-2 font-medium">Unlock ✓</th>
                <th className="text-right py-2 font-medium">Unlock ✗</th>
                <th className="text-right py-2 font-medium">Dino</th>
                <th className="text-right py-2 font-medium">Logo</th>
                <th className="text-right py-2 font-medium">Total</th>
                <th className="text-right py-2 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-muted-foreground/70">
                    No matching users.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((row) => (
                  <tr key={row.userId ?? "__null__"} className="hover:bg-muted/40">
                    <td className="py-2">
                      <div className="font-medium text-foreground">{displayName(row)}</div>
                      {row.email && (
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {row.audiences.length === 0 ? "—" : row.audiences.join(", ")}
                    </td>
                    <td className="py-2 text-right font-mono">{row.counts.PARTY_VISIT}</td>
                    <td className="py-2 text-right font-mono">{row.counts.CODE_UNLOCK_SUCCESS}</td>
                    <td className="py-2 text-right font-mono">{row.counts.CODE_UNLOCK_FAILURE}</td>
                    <td className="py-2 text-right font-mono">{row.counts.DINO_REWARD_EARNED}</td>
                    <td className="py-2 text-right font-mono">{row.counts.LOGO_TRAIL_TRIGGERED}</td>
                    <td className="py-2 text-right font-mono font-semibold">{row.total}</td>
                    <td className="py-2 text-right font-mono text-xs text-muted-foreground">
                      {row.lastSeen ? formatTimestamp(row.lastSeen) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-foreground">Recent events</h2>
          <div className="text-xs text-muted-foreground">
            {recent.total === 0
              ? "No events yet"
              : `Showing ${recentStart}–${recentEnd} of ${recent.total}`}
          </div>
        </div>
        {recent.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events on this page.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 font-medium">Time</th>
                  <th className="text-left py-2 font-medium">User</th>
                  <th className="text-left py-2 font-medium">Audience</th>
                  <th className="text-left py-2 font-medium">Event</th>
                  <th className="text-left py-2 font-medium">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recent.entries.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/40">
                    <td className="py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {formatTimestamp(e.createdAt)}
                    </td>
                    <td className="py-2">
                      {displayName({
                        firstName: e.user?.firstName ?? null,
                        lastName: e.user?.lastName ?? null,
                        email: e.user?.email ?? null,
                        userId: e.user?.id ?? null,
                      })}
                      {e.user?.email && (
                        <div className="text-xs text-muted-foreground">{e.user.email}</div>
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground capitalize">{e.audience}</td>
                    <td className="py-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${EVENT_COLORS[e.eventType]} text-white`}
                      >
                        {EVENT_LABELS[e.eventType]}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground font-mono max-w-xs truncate">
                      {e.metadata ? JSON.stringify(e.metadata) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 mt-3">
          <Link
            to={`?recentLimit=${recent.limit}&recentOffset=${prevOffset}`}
            aria-disabled={!hasPrev}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border border-border ${
              hasPrev
                ? "bg-card text-foreground hover:bg-muted/50"
                : "bg-muted/30 text-muted-foreground/50 pointer-events-none"
            }`}
          >
            ← Prev
          </Link>
          <Link
            to={`?recentLimit=${recent.limit}&recentOffset=${nextOffset}`}
            aria-disabled={!hasNext}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border border-border ${
              hasNext
                ? "bg-card text-foreground hover:bg-muted/50"
                : "bg-muted/30 text-muted-foreground/50 pointer-events-none"
            }`}
          >
            Next →
          </Link>
        </div>
      </div>
    </div>
  );
}
