import { Form, Link, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/admin-console.activity";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { AUDIT_ACTIONS } from "~/lib/audit";
import { ListTodo, ChevronLeft, ChevronRight, X } from "lucide-react";

export const meta: Route.MetaFunction = () => [{ title: "Activity · Operations · DALI OS" }];

// Read-only viewer over the AuditLog table. Adds headline counts, a 30-day
// events chart, top-actions list, and filter controls that map directly onto
// the indexed columns (action, userId, createdAt) so paginated lookups stay
// O(index-seek) even as the table grows.

const PAGE_SIZE = 50;
const CHART_DAYS = 30;
const RANGE_PRESETS: Record<string, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

type DayRow = { day: string; count: number };
type ActionRow = { action: string; count: number };

function parseFilters(url: URL) {
  const action = url.searchParams.get("action") || "";
  const userId = url.searchParams.get("userId") || "";
  const actor = url.searchParams.get("actor") || "";
  const targetId = url.searchParams.get("targetId") || "";
  const range = url.searchParams.get("range") || "";

  let since: Date | null = null;
  if (range && RANGE_PRESETS[range]) {
    since = new Date(Date.now() - RANGE_PRESETS[range] * 24 * 60 * 60 * 1000);
  }

  return { action, userId, actor, targetId, range, since };
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin-console/members");

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const skip = (page - 1) * PAGE_SIZE;
  const filters = parseFilters(url);

  // Resolve `actor` text search (name / email substring) → list of userIds.
  // The matching User table is tiny (~100 rows), so this is fast and the
  // resulting userId IN (...) clause still hits the userId index on AuditLog.
  let actorUserIds: string[] | null = null;
  if (filters.actor) {
    const matches = await prisma.user.findMany({
      where: {
        OR: [
          { firstName: { contains: filters.actor, mode: "insensitive" } },
          { lastName: { contains: filters.actor, mode: "insensitive" } },
          { daliEmail: { contains: filters.actor, mode: "insensitive" } },
          { dartmouthEmail: { contains: filters.actor, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: 200,
    });
    actorUserIds = matches.map((u) => u.id);
    // No matches → guarantee empty result without sending a giant IN ().
    if (actorUserIds.length === 0) actorUserIds = ["__no_match__"];
  }

  const where: Parameters<typeof prisma.auditLog.findMany>[0] extends infer T
    ? T extends { where?: infer W }
      ? W
      : never
    : never = {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.userId
      ? { userId: filters.userId }
      : actorUserIds
        ? { userId: { in: actorUserIds } }
        : {}),
    ...(filters.targetId ? { targetId: filters.targetId } : {}),
    ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
  };

  // Take one extra to detect a next page without a count() (count over a
  // large AuditLog with no filter is expensive).
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    skip,
  });
  const hasNext = rows.length > PAGE_SIZE;
  const entries = rows.slice(0, PAGE_SIZE);

  // Charts always reflect the last 30 days, independent of the table's
  // page/filter state — so the viewer always has a stable baseline. They do
  // respect the action filter though, since that's the most common reason to
  // ask "what's the trend of X?".
  const chartSince = new Date(Date.now() - CHART_DAYS * 24 * 60 * 60 * 1000);
  const [dayRows, actionRows, todayRow, weekRow] = await Promise.all([
    filters.action
      ? prisma.$queryRaw<DayRow[]>`
          SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
                 COUNT(*)::int AS count
          FROM "AuditLog"
          WHERE "createdAt" >= ${chartSince} AND "action" = ${filters.action}
          GROUP BY 1 ORDER BY 1 ASC
        `
      : prisma.$queryRaw<DayRow[]>`
          SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
                 COUNT(*)::int AS count
          FROM "AuditLog"
          WHERE "createdAt" >= ${chartSince}
          GROUP BY 1 ORDER BY 1 ASC
        `,
    prisma.$queryRaw<ActionRow[]>`
      SELECT "action", COUNT(*)::int AS count
      FROM "AuditLog"
      WHERE "createdAt" >= ${chartSince}
      GROUP BY "action"
      ORDER BY count DESC
      LIMIT 15
    `,
    prisma.auditLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.auditLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
  ]);

  const dayMap = new Map(dayRows.map((r) => [r.day, r]));
  const fullSeries: DayRow[] = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    fullSeries.push(dayMap.get(key) ?? { day: key, count: 0 });
  }

  // Resolve actor + target names for the visible page.
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.userId) ids.add(e.userId);
    if (e.targetId) ids.add(e.targetId);
  }
  const users =
    ids.size === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: Array.from(ids) } },
          select: { id: true, firstName: true, lastName: true, daliEmail: true },
        });
  const userById = new Map(users.map((u) => [u.id, u]));

  return {
    page,
    hasNext,
    filters: {
      action: filters.action,
      userId: filters.userId,
      actor: filters.actor,
      targetId: filters.targetId,
      range: filters.range,
    },
    series: fullSeries,
    topActions: actionRows,
    todayCount: todayRow,
    weekCount: weekRow,
    actions: AUDIT_ACTIONS,
    entries: entries.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      action: e.action,
      actor: e.userId ? (userById.get(e.userId) ?? null) : null,
      actorId: e.userId,
      target: e.targetId ? (userById.get(e.targetId) ?? null) : null,
      targetId: e.targetId,
      metadata: e.metadata,
      ip: e.ip,
    })),
  };
}

function displayActor(
  u: { firstName: string; lastName: string; daliEmail: string | null } | null,
  fallbackId: string | null,
) {
  if (!u)
    return fallbackId ? (
      <span className="font-mono text-xs text-muted-foreground/70">{fallbackId.slice(0, 8)}…</span>
    ) : (
      <span className="text-muted-foreground/60 italic">system</span>
    );
  const name = `${u.firstName} ${u.lastName}`.trim();
  return <span>{name || u.daliEmail || "—"}</span>;
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground/70">{sub}</div>
    </div>
  );
}

function DayBars({ series }: { series: DayRow[] }) {
  const max = Math.max(1, ...series.map((d) => d.count));
  return (
    <div className="flex items-end gap-0.5 h-32">
      {series.map((d) => {
        const h = Math.max(2, Math.round((d.count / max) * 120));
        return (
          <div
            key={d.day}
            className="flex-1 bg-primary/70 hover:bg-primary rounded-sm"
            style={{ height: `${h}px` }}
            title={`${d.day}: ${d.count} events`}
          />
        );
      })}
    </div>
  );
}

export default function AdminConsoleActivity() {
  const {
    page,
    hasNext,
    filters,
    series,
    topActions,
    todayCount,
    weekCount,
    actions,
    entries,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  const totalInWindow = series.reduce((s, d) => s + d.count, 0);
  const maxActionCount = Math.max(1, ...topActions.map((a) => a.count));
  const activeFilterCount = [
    filters.action,
    filters.userId,
    filters.actor,
    filters.targetId,
    filters.range,
  ].filter(Boolean).length;

  // Build a querystring that preserves filters but resets the page, used by
  // the action-pill links so a top-action click drills in without dragging
  // an unrelated page offset along.
  function filterHref(overrides: Record<string, string | null>): string {
    const next = new URLSearchParams(searchParams);
    next.delete("page");
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    return s ? `?${s}` : "";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ListTodo className="w-6 h-6 text-foreground/80" />
        <h1 className="text-2xl font-bold text-foreground">Activity log</h1>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          page {page}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Events today" value={todayCount} sub="last 24h" />
        <Stat label="Events this week" value={weekCount} sub="last 7d" />
        <Stat label="Events this month" value={totalInWindow} sub={`last ${CHART_DAYS}d`} />
      </div>

      <section className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-sm font-medium text-foreground mb-3">
          Events per day
          {filters.action ? (
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              filtered: {filters.action}
            </span>
          ) : null}
        </h2>
        <DayBars series={series} />
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground/70">
          <span>{series[0]?.day}</span>
          <span>{series[series.length - 1]?.day}</span>
        </div>
      </section>

      <section className="bg-card border border-border rounded-lg overflow-hidden">
        <h2 className="text-sm font-medium text-foreground px-4 py-3 border-b border-border">
          Top actions (last {CHART_DAYS}d)
        </h2>
        {topActions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground/70">No events in window.</p>
        ) : (
          <ul className="divide-y divide-border">
            {topActions.map((a) => (
              <li key={a.action}>
                <Link
                  to={filterHref({ action: filters.action === a.action ? null : a.action })}
                  className={`block px-4 py-2 text-sm hover:bg-muted/50 ${
                    filters.action === a.action ? "bg-muted/40" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <code className="font-mono text-xs text-foreground">{a.action}</code>
                    <span className="text-xs text-muted-foreground tabular-nums">{a.count}</span>
                  </div>
                  <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/60"
                      style={{ width: `${(a.count / maxActionCount) * 100}%` }}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Form
        method="get"
        className="bg-card border border-border rounded-lg p-3 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end"
      >
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Action
          <select
            name="action"
            defaultValue={filters.action}
            className="bg-page border border-border rounded px-2 py-1.5 text-sm text-foreground font-mono"
          >
            <option value="">— any —</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Actor (name or email)
          <input
            type="text"
            name="actor"
            defaultValue={filters.actor}
            placeholder="kiran"
            className="bg-page border border-border rounded px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Actor user id
          <input
            type="text"
            name="userId"
            defaultValue={filters.userId}
            placeholder="cuid"
            className="bg-page border border-border rounded px-2 py-1.5 text-sm text-foreground font-mono"
          />
        </label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Target id
          <input
            type="text"
            name="targetId"
            defaultValue={filters.targetId}
            placeholder="cuid"
            className="bg-page border border-border rounded px-2 py-1.5 text-sm text-foreground font-mono"
          />
        </label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Range
          <select
            name="range"
            defaultValue={filters.range}
            className="bg-page border border-border rounded px-2 py-1.5 text-sm text-foreground"
          >
            <option value="">All time</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </label>
        <div className="sm:col-span-5 flex items-center gap-2">
          <button
            type="submit"
            className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:opacity-90"
          >
            Apply
          </button>
          {activeFilterCount > 0 && (
            <Link
              to="?"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm bg-card border border-border text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
              Clear filters
            </Link>
          )}
          {activeFilterCount > 0 && (
            <span className="text-xs text-muted-foreground/70 ml-auto">
              {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
            </span>
          )}
        </div>
      </Form>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">When</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actor</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Target</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Metadata</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground/70">
                  No activity matches these filters.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  {e.actorId ? (
                    <Link
                      to={filterHref({ userId: e.actorId, actor: null })}
                      className="hover:underline"
                    >
                      {displayActor(e.actor, e.actorId)}
                    </Link>
                  ) : (
                    displayActor(null, null)
                  )}
                </td>
                <td className="px-4 py-3">
                  <Link
                    to={filterHref({ action: e.action })}
                    className="font-mono text-xs text-foreground hover:underline"
                  >
                    {e.action}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {e.targetId ? (
                    <Link
                      to={filterHref({ targetId: e.targetId })}
                      className="hover:underline"
                    >
                      {displayActor(e.target, e.targetId)}
                    </Link>
                  ) : (
                    displayActor(null, null)
                  )}
                </td>
                <td className="px-4 py-3">
                  {e.metadata ? (
                    <code
                      className="block text-[11px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5 max-w-md truncate"
                      title={JSON.stringify(e.metadata)}
                    >
                      {JSON.stringify(e.metadata)}
                    </code>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav className="flex items-center justify-between" aria-label="Activity pagination">
        {page > 1 ? (
          <Link
            to={filterHref({ page: String(page - 1) })}
            prefetch="render"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm bg-card border border-border text-foreground hover:bg-muted/50"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </Link>
        ) : (
          <span />
        )}
        {hasNext ? (
          <Link
            to={filterHref({ page: String(page + 1) })}
            prefetch="render"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm bg-card border border-border text-foreground hover:bg-muted/50"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground/60">End of log</span>
        )}
      </nav>
    </div>
  );
}
