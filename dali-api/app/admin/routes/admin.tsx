import { Link, redirect, useLoaderData } from "react-router";
import { Activity, ArrowRight, Clock, Mail, SendHorizonal, Sparkles } from "lucide-react";
import type { Route } from "./+types/admin";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { cn } from "~/lib/cn";
import { fullName } from "~/lib/display";
import { listSenderIntegrations } from "~/lib/gmail-integration";
import { EMAIL_PURPOSE_KEYS, EMAIL_PURPOSES } from "~/lib/email-identities";
import { ADMIN_CLUSTERS } from "~/admin/adminNav";
import { StatusDot, UsageGauge, type Tone } from "~/admin/components/console-ui";

export const meta: Route.MetaFunction = () => [{ title: "Admin · DALI OS" }];

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// The Admin hub is a system console: live health up top, then a jump-off to the
// tools. Any Core member may enter; the Finance cluster is Admin-only and
// hidden from the launcher for everyone else. All signals are cheap counts with
// 0/empty fallbacks, so the console degrades gracefully on an empty table.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const dayUtc = new Date().toISOString().slice(0, 10);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    admin,
    jobsEnabled,
    jobsFailing,
    outboundPending,
    outboundDead,
    aiAgg,
    siteErrors24h,
    senderRows,
    auditRows,
  ] = await Promise.all([
    isAdmin(auth.user.sub),
    prisma.scheduledJob.count({ where: { enabled: true } }),
    prisma.scheduledJob.count({ where: { enabled: true, lastStatus: "Error" } }),
    prisma.outboundMessage.count({ where: { status: "Pending" } }),
    prisma.outboundMessage.count({ where: { status: "Dead" } }),
    prisma.aiUsage.aggregate({
      where: { day: dayUtc },
      _sum: { count: true, inputTokens: true, outputTokens: true },
    }),
    prisma.clientError.count({ where: { createdAt: { gte: since24h } } }),
    listSenderIntegrations(),
    prisma.auditLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 6,
    }),
  ]);

  // Newest enabled row per purpose (matches the Email Senders page resolution).
  const byPurpose = new Map<string, (typeof senderRows)[number]>();
  for (const row of senderRows) {
    if (row.enabled && !byPurpose.has(row.purpose)) byPurpose.set(row.purpose, row);
  }
  const connectedIds = [...byPurpose.values()].map((r) => r.id);

  const auditUserIds = new Set<string>();
  for (const e of auditRows) {
    if (e.userId) auditUserIds.add(e.userId);
    if (e.targetId) auditUserIds.add(e.targetId);
  }

  // Second hop: today's per-sender usage + activity-feed display names.
  const [usageRows, auditUsers] = await Promise.all([
    connectedIds.length
      ? prisma.senderDailyUsage.findMany({
          where: { senderId: { in: connectedIds }, day: dayUtc },
          select: { senderId: true, count: true },
        })
      : Promise.resolve([]),
    auditUserIds.size
      ? prisma.user.findMany({
          where: { id: { in: [...auditUserIds] } },
          select: { id: true, firstName: true, lastName: true, daliEmail: true },
        })
      : Promise.resolve([]),
  ]);
  const usageById = new Map(usageRows.map((u) => [u.senderId, u.count]));
  const auditById = new Map(auditUsers.map((u) => [u.id, u]));

  const senders = EMAIL_PURPOSE_KEYS.map((purpose) => {
    const row = byPurpose.get(purpose);
    return {
      purpose,
      label: EMAIL_PURPOSES[purpose].label,
      connected: !!row?.sendAsEmail,
      today: row ? (usageById.get(row.id) ?? 0) : 0,
      cap: row?.dailyCap ?? null,
    };
  });

  const nameOf = (id: string | null) => {
    if (!id) return null;
    const u = auditById.get(id);
    return u ? fullName(u) || u.daliEmail || null : null;
  };
  const recent = auditRows.map((e) => ({
    id: e.id,
    action: e.action,
    actor: nameOf(e.userId),
    target: nameOf(e.targetId),
    createdAt: e.createdAt.toISOString(),
  }));

  return {
    isAdmin: admin,
    badges: { jobs: jobsFailing } as Record<string, number>,
    health: {
      jobsEnabled,
      jobsFailing,
      outboundPending,
      outboundDead,
      aiRequests: aiAgg._sum.count ?? 0,
      aiTokens: (aiAgg._sum.inputTokens ?? 0) + (aiAgg._sum.outputTokens ?? 0),
      siteErrors24h,
    },
    senders,
    recent,
  };
}

function badgeLabel(key: string, n: number): string {
  if (key === "jobs") return `${n} failing`;
  return String(n);
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function HealthTile({
  to,
  icon: Icon,
  label,
  tone,
  primary,
  secondary,
}: {
  to: string;
  icon: typeof Clock;
  label: string;
  tone: Tone;
  primary: string;
  secondary: string;
}) {
  return (
    <Link
      to={to}
      className="flex-1 basis-40 rounded-lg border border-border bg-card p-3 shadow-brand-1 transition-all hover:border-accent-coral/60 hover:shadow-brand-2"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <StatusDot tone={tone} />
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 text-lg font-semibold text-foreground tabular-nums">
        {primary}
      </div>
      <div className="text-[11px] text-muted-foreground/70 tabular-nums">
        {secondary}
      </div>
    </Link>
  );
}

export default function AdminHub() {
  const { isAdmin: admin, badges, health, senders, recent } =
    useLoaderData<typeof loader>();
  // Agreements live in the Drive — the "documents" cluster is removed from the
  // Admin hub to keep one authoring surface.
  const clusters = ADMIN_CLUSTERS.filter(
    (c) => (admin || !c.adminOnly) && c.key !== "documents",
  );

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Admin</h1>
        <p className="text-sm text-muted-foreground">
          System console — jobs, delivery, telemetry, and access.
        </p>
      </header>

      {/* System health strip */}
      <section aria-label="System health" className="flex flex-wrap gap-3">
        <HealthTile
          to="/admin/jobs"
          icon={Clock}
          label="Jobs"
          tone={health.jobsFailing > 0 ? "bad" : "ok"}
          primary={`${health.jobsEnabled} on`}
          secondary={`${health.jobsFailing} failing`}
        />
        <HealthTile
          to="/admin/outbound-messages"
          icon={SendHorizonal}
          label="Outbound"
          tone={
            health.outboundDead > 0
              ? "bad"
              : health.outboundPending > 0
                ? "warn"
                : "ok"
          }
          primary={`${health.outboundPending} pending`}
          secondary={`${health.outboundDead} dead-lettered`}
        />
        <HealthTile
          to="/admin/ai-usage"
          icon={Sparkles}
          label="AI today"
          tone="idle"
          primary={`${health.aiRequests.toLocaleString()} req`}
          secondary={`${compact.format(health.aiTokens)} tokens`}
        />
        <HealthTile
          to="/admin/analytics"
          icon={Activity}
          label="Site (24h)"
          tone={health.siteErrors24h > 0 ? "warn" : "ok"}
          primary={`${health.siteErrors24h} errors`}
          secondary="client errors, last 24h"
        />
      </section>

      {/* Recent activity + email-sender usage */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4 shadow-brand-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Recent activity
            </h2>
            <Link
              to="/admin/activity"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent-coral hover:underline"
            >
              Full audit log <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground/70">
              No recent activity.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {recent.map((e) => (
                <li
                  key={e.id}
                  className="flex items-baseline gap-2 py-1.5 text-sm"
                >
                  <span className="truncate text-foreground">
                    {e.actor ?? <span className="italic text-muted-foreground/60">system</span>}
                  </span>
                  <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {e.action}
                  </code>
                  {e.target && (
                    <span className="truncate text-muted-foreground">→ {e.target}</span>
                  )}
                  <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-muted-foreground/60 tabular-nums">
                    {ago(e.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4 shadow-brand-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Email senders
            </h2>
            <Link
              to="/admin/email-senders"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent-coral hover:underline"
            >
              Configure <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
          <ul className="flex flex-col gap-2.5">
            {senders.map((s) => (
              <li key={s.purpose} className="flex items-center gap-3 text-sm">
                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="w-20 shrink-0 truncate text-foreground">{s.label}</span>
                <UsageGauge value={s.today} max={s.cap} className="min-w-0 flex-1" />
                <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                  {s.connected ? (
                    <>
                      {s.today}
                      {s.cap != null ? `/${s.cap}` : ""}
                    </>
                  ) : (
                    <span className="text-muted-foreground/50">off</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Jump to the tools */}
      <div className="flex flex-col gap-6">
        {clusters.map((cluster) => (
          <section key={cluster.key} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <cluster.icon
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {cluster.label}
                </h2>
              </div>
              {cluster.hubPath && (
                <Link
                  to={cluster.hubPath}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-coral hover:underline"
                >
                  Open <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cluster.sections.map((s) => (
                <Link
                  key={s.key}
                  to={s.to}
                  className="rounded-lg border border-border bg-card p-4 shadow-brand-1 transition-all hover:border-accent-coral/60 hover:shadow-brand-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <s.icon
                        className="h-4 w-4 shrink-0 text-accent-coral"
                        aria-hidden
                      />
                      <h3 className="truncate font-heading font-semibold text-foreground">
                        {s.label}
                      </h3>
                    </div>
                    {badges[s.key] > 0 && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                          s.key === "jobs"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-accent-coral/10 text-accent-coral",
                        )}
                      >
                        {badgeLabel(s.key, badges[s.key])}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {s.description}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
