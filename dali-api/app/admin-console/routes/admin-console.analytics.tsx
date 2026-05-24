import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console.analytics";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { BarChart3, AlertTriangle } from "lucide-react";

export const meta: Route.MetaFunction = () => [
  { title: "Analytics · Operations · DALI OS" },
];

// Site-usage + crash dashboard for admins. Aggregates PageView and ClientError
// for the last 30 days on every load — at this app's scale (hundreds of rows
// per day) this is cheap enough that no rollup table is needed.

const WINDOW_DAYS = 30;

type DayRow = { day: string; users: number; views: number };
type RouteRow = { path: string; views: number; users: number };
type ErrorRow = {
  message: string;
  count: number;
  users: number;
  firstSeen: Date;
  lastSeen: Date;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin-console/members");

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Per-day active users + total views over the window. Postgres date_trunc
  // makes a clean 30-row series even on days with zero traffic returning null
  // (we backfill empty days on the client).
  const dayRows = await prisma.$queryRaw<DayRow[]>`
    SELECT
      to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
      COUNT(DISTINCT "userId")::int AS users,
      COUNT(*)::int AS views
    FROM "PageView"
    WHERE "createdAt" >= ${since}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  // Top routes by pageviews. Path is already normalized (e.g. /projects/:id).
  const routeRows = await prisma.$queryRaw<RouteRow[]>`
    SELECT
      "path",
      COUNT(*)::int AS views,
      COUNT(DISTINCT "userId")::int AS users
    FROM "PageView"
    WHERE "createdAt" >= ${since}
    GROUP BY "path"
    ORDER BY views DESC
    LIMIT 20
  `;

  const errorRows = await prisma.$queryRaw<ErrorRow[]>`
    SELECT
      "message",
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

  // Headline numbers.
  const [wauRow] = await prisma.$queryRaw<{ wau: number }[]>`
    SELECT COUNT(DISTINCT "userId")::int AS wau
    FROM "PageView"
    WHERE "createdAt" >= ${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)}
      AND "userId" IS NOT NULL
  `;
  const [mauRow] = await prisma.$queryRaw<{ mau: number }[]>`
    SELECT COUNT(DISTINCT "userId")::int AS mau
    FROM "PageView"
    WHERE "createdAt" >= ${since} AND "userId" IS NOT NULL
  `;

  // Backfill missing days with zeros so the bar chart is even across the window.
  const dayMap = new Map(dayRows.map((r) => [r.day, r]));
  const fullSeries: DayRow[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    fullSeries.push(dayMap.get(key) ?? { day: key, users: 0, views: 0 });
  }

  return {
    windowDays: WINDOW_DAYS,
    wau: wauRow?.wau ?? 0,
    mau: mauRow?.mau ?? 0,
    series: fullSeries,
    routes: routeRows,
    errors: errorRows.map((e) => ({
      ...e,
      firstSeen: e.firstSeen.toISOString(),
      lastSeen: e.lastSeen.toISOString(),
    })),
  };
}

function DayBars({ series }: { series: DayRow[] }) {
  const max = Math.max(1, ...series.map((d) => d.users));
  return (
    <div className="flex items-end gap-0.5 h-32">
      {series.map((d) => {
        const h = Math.max(2, Math.round((d.users / max) * 120));
        return (
          <div
            key={d.day}
            className="flex-1 bg-primary/70 hover:bg-primary rounded-sm"
            style={{ height: `${h}px` }}
            title={`${d.day}: ${d.users} users · ${d.views} views`}
          />
        );
      })}
    </div>
  );
}

export default function AdminConsoleAnalytics() {
  const { windowDays, wau, mau, series, routes, errors } =
    useLoaderData<typeof loader>();

  const totalViews = series.reduce((s, d) => s + d.views, 0);
  const maxRouteViews = Math.max(1, ...routes.map((r) => r.views));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-6 h-6 text-foreground/80" />
        <h1 className="text-2xl font-bold text-foreground">Site analytics</h1>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          last {windowDays} days
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Weekly active users" value={wau} sub="distinct logins, 7d" />
        <Stat label="Monthly active users" value={mau} sub={`distinct logins, ${windowDays}d`} />
        <Stat label="Total pageviews" value={totalViews} sub={`${windowDays}d`} />
      </div>

      <section className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-foreground">Daily active users</h2>
          <Link
            to="/admin-console/activity"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View audit log →
          </Link>
        </div>
        <DayBars series={series} />
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground/70">
          <span>{series[0]?.day}</span>
          <span>{series[series.length - 1]?.day}</span>
        </div>
      </section>

      <section className="bg-card border border-border rounded-lg overflow-hidden">
        <h2 className="text-sm font-medium text-foreground px-4 py-3 border-b border-border">
          Top routes
        </h2>
        {routes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground/70">No pageviews yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {routes.map((r) => (
              <li key={r.path} className="px-4 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <code className="font-mono text-xs text-foreground truncate">
                    {r.path || "/"}
                  </code>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground whitespace-nowrap">
                    <span>{r.users} users</span>
                    <span className="tabular-nums">{r.views} views</span>
                  </div>
                </div>
                <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/60"
                    style={{ width: `${(r.views / maxRouteViews) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-card border border-border rounded-lg overflow-hidden">
        <h2 className="text-sm font-medium text-foreground px-4 py-3 border-b border-border flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          Client errors
          <span className="text-xs text-muted-foreground font-normal ml-1">
            ({errors.length})
          </span>
        </h2>
        {errors.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground/70">
            No client errors in the last {windowDays} days. 🎉
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Message</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Count</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Users</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {errors.map((e) => (
                <tr key={e.message} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 max-w-md">
                    <code className="block text-xs text-foreground truncate" title={e.message}>
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

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground/70">{sub}</div>
    </div>
  );
}
