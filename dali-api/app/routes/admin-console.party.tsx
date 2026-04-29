import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console.party";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { Sparkles } from "lucide-react";

export const meta: Route.MetaFunction = () => [
  { title: "Party · Admin console · DALI OS" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin-console/members");

  const since = new Date(Date.now() - 30 * DAY_MS);

  const [byEventType, byEventTypeAudience, uniqueVisitors, recentByDay] = await Promise.all([
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

  const dayBuckets = new Map<string, number>();
  for (const row of recentByDay) {
    const key = row.createdAt.toISOString().slice(0, 10);
    dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + 1);
  }
  const timeline = Array.from(dayBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }));

  return {
    totals,
    uniqueVisitors: uniqueVisitors.filter((v) => v.userId !== null).length,
    unlocksByAudience,
    timeline,
  };
}

export default function AdminConsoleParty() {
  const { totals, uniqueVisitors, unlocksByAudience, timeline } =
    useLoaderData<typeof loader>();

  const cards: { label: string; value: number }[] = [
    { label: "Total visits", value: totals.PARTY_VISIT ?? 0 },
    { label: "Unique visitors", value: uniqueVisitors },
    { label: "Code unlocks", value: totals.CODE_UNLOCK_SUCCESS ?? 0 },
    { label: "Unlock failures", value: totals.CODE_UNLOCK_FAILURE ?? 0 },
    { label: "Dino rewards earned", value: totals.DINO_REWARD_EARNED ?? 0 },
    { label: "Logo trail triggers", value: totals.LOGO_TRAIL_TRIGGERED ?? 0 },
  ];

  const maxDay = timeline.reduce((m, b) => Math.max(m, b.count), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Sparkles className="w-6 h-6 text-foreground/80" />
        <h1 className="text-2xl font-bold text-foreground">Party Analytics</h1>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          aggregates only
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
        <h2 className="text-sm font-semibold text-foreground mb-3">
          Daily volume (last 30 days)
        </h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded yet.</p>
        ) : (
          <div className="space-y-1">
            {timeline.map(({ day, count }) => (
              <div key={day} className="flex items-center gap-3 text-xs">
                <span className="w-20 font-mono text-muted-foreground">{day}</span>
                <div className="flex-1 bg-muted/40 rounded h-3 overflow-hidden">
                  <div
                    className="h-full bg-accent-coral/70"
                    style={{
                      width: `${maxDay > 0 ? (count / maxDay) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="w-10 text-right font-mono text-foreground">
                  {count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
