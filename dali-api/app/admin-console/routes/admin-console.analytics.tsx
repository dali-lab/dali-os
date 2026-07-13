import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console.analytics";
import { adminPills } from "~/admin-console/adminPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { BarChart3, AlertTriangle } from "lucide-react";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "Analytics · Admin · DALI OS" },
];

// Slim usage + crash dashboard for a mandated internal tool. We don't track
// growth (usage is captive) or retention (mandated → ~100%); what's useful is:
//   - Is the deploy alive? (one headline, 7d sanity check)
//   - What features earn their keep? (top routes)
//   - What can we delete? (bottom routes — rarely-visited paths)
//   - Is anything broken? (error rate trend + grouped error list)

const RANGE_OPTIONS = [
  { key: "7d", days: 7, label: "7 days" },
  { key: "30d", days: 30, label: "30 days" },
  { key: "90d", days: 90, label: "90 days" },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];

type DayRow = { day: string; count: number };
type RouteRow = { path: string; views: number; users: number };
type ErrorRow = {
  message: string;
  count: number;
  users: number;
  firstSeen: Date;
  lastSeen: Date;
};
type ErrorDayRow = { day: string; count: number };

function resolveRange(raw: string | null) {
  const match = RANGE_OPTIONS.find((r) => r.key === raw);
  return match ?? RANGE_OPTIONS[1]; // default 30d
}

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function backfillDays(days: number, rows: { day: string; count: number }[]) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    out.push(map.get(key) ?? { day: key, count: 0 });
  }
  return out;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin-console/members");

  const url = new URL(request.url);
  const range = resolveRange(url.searchParams.get("range"));
  const since = sinceDate(range.days);
  const sevenDaysAgo = sinceDate(7);

  // The "is the deploy alive?" sanity number — always 7d, ignores the range
  // selector so it stays a stable health check.
  const [wauRow] = await prisma.$queryRaw<{ wau: number }[]>`
    SELECT COUNT(DISTINCT "userId")::int AS wau
    FROM "PageView"
    WHERE "createdAt" >= ${sevenDaysAgo} AND "userId" IS NOT NULL
  `;

  // Pageviews per day in the selected window — drives the small trend chart.
  const dayRows = await prisma.$queryRaw<DayRow[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS count
    FROM "PageView"
    WHERE "createdAt" >= ${since}
    GROUP BY 1 ORDER BY 1 ASC
  `;
  const trend = backfillDays(range.days, dayRows);

  // Top + bottom routes share the same shape; both are normalized paths so a
  // route like /projects/:id collapses across all projects.
  const topRoutes = await prisma.$queryRaw<RouteRow[]>`
    SELECT "path",
           COUNT(*)::int AS views,
           COUNT(DISTINCT "userId")::int AS users
    FROM "PageView"
    WHERE "createdAt" >= ${since}
    GROUP BY "path"
    ORDER BY views DESC
    LIMIT 10
  `;

  // "Rarely-visited" rather than "never-visited" — a route with zero
  // PageView rows ever isn't measurable from this table anyway. ASC catches
  // the long-tail features that exist but nobody uses, which is the
  // actionable "consider deleting this" signal.
  const bottomRoutes = await prisma.$queryRaw<RouteRow[]>`
    SELECT "path",
           COUNT(*)::int AS views,
           COUNT(DISTINCT "userId")::int AS users
    FROM "PageView"
    WHERE "createdAt" >= ${since}
    GROUP BY "path"
    HAVING COUNT(*) < 5
    ORDER BY views ASC, "path" ASC
    LIMIT 10
  `;

  // Errors over time + grouped list. The sparkline tells you "did errors
  // spike at some point in the window"; the list tells you what they were.
  const errorDayRows = await prisma.$queryRaw<ErrorDayRow[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS count
    FROM "ClientError"
    WHERE "createdAt" >= ${since}
    GROUP BY 1 ORDER BY 1 ASC
  `;
  const errorTrend = backfillDays(range.days, errorDayRows);

  const errorRows = await prisma.$queryRaw<ErrorRow[]>`
    SELECT "message",
           COUNT(*)::int AS count,
           COUNT(DISTINCT "userId")::int AS users,
           MIN("createdAt") AS "firstSeen",
           MAX("createdAt") AS "lastSeen"
    FROM "ClientError"
    WHERE "createdAt" >= ${since}
    GROUP BY "message"
    ORDER BY "lastSeen" DESC
    LIMIT 50
  `;

  return {
    rangeKey: range.key,
    rangeLabel: range.label,
    rangeDays: range.days,
    wau: wauRow?.wau ?? 0,
    trend,
    topRoutes,
    bottomRoutes,
    errorTrend,
    totalErrors: errorTrend.reduce((s, d) => s + d.count, 0),
    errors: errorRows.map((e) => ({
      ...e,
      firstSeen: e.firstSeen.toISOString(),
      lastSeen: e.lastSeen.toISOString(),
    })),
  };
}

function Sparkline({ series, accent }: { series: DayRow[]; accent: "primary" | "amber" }) {
  const max = Math.max(1, ...series.map((d) => d.count));
  const barClass =
    accent === "primary" ? "bg-primary/70 hover:bg-primary" : "bg-amber-500/70 hover:bg-amber-500";
  return (
    <div className="flex items-end gap-0.5 h-16">
      {series.map((d) => {
        const h = Math.max(2, Math.round((d.count / max) * 60));
        return (
          <div
            key={d.day}
            className={`flex-1 rounded-sm ${barClass}`}
            style={{ height: `${h}px` }}
            title={`${d.day}: ${d.count}`}
          />
        );
      })}
    </div>
  );
}

function RouteList({
  rows,
  emptyText,
}: {
  rows: RouteRow[];
  emptyText: string;
}) {
  const maxViews = Math.max(1, ...rows.map((r) => r.views));
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground/70">{emptyText}</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.path} className="px-4 py-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <code className="font-mono text-xs text-foreground truncate">{r.path || "/"}</code>
            <div className="flex items-center gap-3 text-xs text-muted-foreground whitespace-nowrap">
              <span>{r.users} users</span>
              <span className="tabular-nums">{r.views} views</span>
            </div>
          </div>
          <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/60"
              style={{ width: `${(r.views / maxViews) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AdminConsoleAnalytics() {
  const {
    rangeKey,
    rangeLabel,
    rangeDays,
    wau,
    trend,
    topRoutes,
    bottomRoutes,
    errorTrend,
    totalErrors,
    errors,
  } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <AreaPillNav items={adminPills({ isAdmin: true, active: "analytics" })} />
      <div className="flex items-center gap-3">
        <BarChart3 className="w-6 h-6 text-foreground/80" />
        <h1 className="text-2xl font-bold text-foreground">Site analytics</h1>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          {rangeLabel}
        </span>
        <div className="ml-auto flex items-center gap-1 text-xs">
          {RANGE_OPTIONS.map((r) => (
            <Link
              key={r.key}
              to={r.key === "30d" ? "?" : `?range=${r.key}`}
              prefetch="render"
              className={`px-2 py-1 rounded-md ${
                r.key === rangeKey
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      <section className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Active users</div>
            <div className="text-3xl font-bold text-foreground tabular-nums">{wau}</div>
            <div className="text-[11px] text-muted-foreground/70">
              distinct logins, last 7 days
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground/70 whitespace-nowrap">
            pageviews · last {rangeDays}d
          </div>
        </div>
        <Sparkline series={trend} accent="primary" />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-card border border-border rounded-lg overflow-hidden">
          <h2 className="text-sm font-medium text-foreground px-4 py-3 border-b border-border">
            Most-used routes
          </h2>
          <RouteList rows={topRoutes} emptyText="No pageviews in window." />
        </section>

        <section className="bg-card border border-border rounded-lg overflow-hidden">
          <h2 className="text-sm font-medium text-foreground px-4 py-3 border-b border-border">
            Rarely-used routes
          </h2>
          <RouteList
            rows={bottomRoutes}
            emptyText="Every visited route saw at least 5 hits — nothing obviously dead."
          />
        </section>
      </div>

      <section className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-medium text-foreground">Client errors</h2>
          <span className="text-xs text-muted-foreground font-normal ml-1">
            ({totalErrors} in {rangeDays}d · {errors.length} distinct)
          </span>
        </div>
        <div className="px-4 py-3 border-b border-border">
          <Sparkline series={errorTrend} accent="amber" />
        </div>
        {errors.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground/70">
            No client errors in the last {rangeDays} days.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                  Message
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Count</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Users</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                  Last seen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {errors.map((e) => (
                <tr key={e.message} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 max-w-md">
                    <code
                      className="block text-xs text-foreground truncate"
                      title={e.message}
                    >
                      {e.message}
                    </code>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{e.count}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{e.users}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground whitespace-nowrap">
                    {new Date(e.lastSeen).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
