// Admin → Communications → Outbound Messages. Transactional outbox viewer:
// recent OutboundMessage rows with status filter + text search. Operator
// actions: Retry a Dead row (reset to Pending) and Cancel a Pending row.
//
// Heavy/stripped columns (bodyHtml, attachments) are excluded — they're
// zeroed after send by the retention janitor and are not useful for triage.

import { redirect, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { SendHorizonal, Mail, MessageSquare } from "lucide-react";
import type { Route } from "./+types/admin.outbound-messages";
import { adminHandle } from "~/admin/adminNav";
import { StatusDot } from "~/admin/components/console-ui";
import { Tooltip } from "~/components/ui/floating";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { buttonClasses } from "~/components/ui/Button";

export const handle = adminHandle("outbound-messages");

export const meta: Route.MetaFunction = () => [
  { title: "Outbound Messages · Admin · DALI OS" },
];

const STATUS_OPTIONS = ["", "Pending", "Sending", "Sent", "Dead", "Canceled"] as const;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";

  // Per-status counts — honor text search but ignore the status filter so every
  // segment shows its true size.
  const grouped = await prisma.outboundMessage.groupBy({
    by: ["status"],
    where: {
      ...(q
        ? {
            OR: [
              { target: { contains: q, mode: "insensitive" } },
              { recipientUserId: { contains: q, mode: "insensitive" } },
              { eventType: { contains: q, mode: "insensitive" } },
              { subject: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    _count: true,
  });
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  // Lightweight columns only — bodyHtml/attachments are heavy and stripped post-send.
  const rows = await prisma.outboundMessage.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(q
        ? {
            OR: [
              { target: { contains: q, mode: "insensitive" } },
              { recipientUserId: { contains: q, mode: "insensitive" } },
              { eventType: { contains: q, mode: "insensitive" } },
              { subject: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      channel: true,
      status: true,
      target: true,
      recipientUserId: true,
      subject: true,
      eventType: true,
      attempts: true,
      lastError: true,
      sentAt: true,
      createdAt: true,
    },
  });

  // Batch-fetch recipient names for rows that have a recipientUserId.
  const recipientIds = [...new Set(rows.flatMap((r) => (r.recipientUserId ? [r.recipientUserId] : [])))];
  const users =
    recipientIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: recipientIds } },
          select: { id: true, firstName: true, lastName: true, daliEmail: true },
        });
  const userById = new Map(users.map((u) => [u.id, u]));

  const messages = rows.map((r) => {
    const u = r.recipientUserId ? userById.get(r.recipientUserId) : undefined;
    const recipientName = u ? fullName(u) || u.daliEmail : null;
    return {
      id: r.id,
      channel: r.channel,
      status: r.status,
      target: r.target,
      recipientName,
      subject: r.subject,
      eventType: r.eventType,
      attempts: r.attempts,
      lastError: r.lastError,
      sentAt: r.sentAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });

  const admin = await isAdmin(auth.user.sub);
  return { messages, statusFilter, q, isAdmin: admin, counts, total };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const intent = form.get("intent");
  const id = form.get("id");

  if (typeof id !== "string" || !id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  if (intent === "retry") {
    // Reset a Dead row so the drain picks it up again.
    await prisma.outboundMessage.update({
      where: { id, status: "Dead" },
      data: { status: "Pending", nextAttemptAt: new Date(), attempts: 0, lastError: null },
    });
    return Response.json({ ok: true });
  }

  if (intent === "cancel") {
    // Cancel a Pending row — won't send.
    await prisma.outboundMessage.update({
      where: { id, status: "Pending" },
      data: { status: "Canceled" },
    });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Invalid intent" }, { status: 400 });
}

// ─── UI helpers ────────────────────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-800",
  Sending: "bg-blue-100 text-blue-800",
  Sent: "bg-emerald-100 text-emerald-800",
  Dead: "bg-red-100 text-red-800",
  Canceled: "bg-zinc-100 text-zinc-600",
};

const STATUS_DOT_TONE: Record<string, "ok" | "warn" | "bad" | "idle"> = {
  Sent: "ok",
  Pending: "warn",
  Sending: "warn",
  Dead: "bad",
  Canceled: "idle",
};

type MessageRow = {
  id: string;
  channel: string;
  status: string;
  target: string;
  recipientName: string | null;
  subject: string | null;
  eventType: string | null;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
};

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "email") {
    return <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

function Row({ msg }: { msg: MessageRow }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const busy = fetcher.state !== "idle";

  return (
    <tr className="border-b border-border last:border-b-0 align-top">
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5">
          <StatusDot tone={STATUS_DOT_TONE[msg.status] ?? "idle"} />
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[msg.status] ?? "bg-zinc-100 text-zinc-600"}`}
          >
            {msg.status}
          </span>
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        <div className="flex items-center gap-1">
          <ChannelIcon channel={msg.channel} />
          {msg.channel}
        </div>
      </td>
      <td className="px-3 py-3">
        {msg.recipientName ? (
          <>
            <div className="text-sm text-foreground">{msg.recipientName}</div>
            <div className="text-xs text-muted-foreground/70">{msg.target}</div>
          </>
        ) : (
          <div className="text-sm text-foreground">{msg.target}</div>
        )}
      </td>
      <td className="px-3 py-3">
        {msg.subject && (
          <Tooltip content={msg.subject}>
            <div className="text-sm text-foreground truncate max-w-[200px]">
              {msg.subject}
            </div>
          </Tooltip>
        )}
        {msg.eventType && (
          <div className="font-mono text-xs text-muted-foreground">{msg.eventType}</div>
        )}
      </td>
      <td className="px-3 py-3 text-center text-xs text-muted-foreground">
        {msg.attempts}
      </td>
      <td className="px-3 py-3 max-w-[220px]">
        {msg.lastError && (
          <Tooltip content={msg.lastError} variant="rich" placement="bottom">
            <p className="break-all text-xs text-red-600">
              {msg.lastError.length > 120
                ? `${msg.lastError.slice(0, 120)}…`
                : msg.lastError}
            </p>
          </Tooltip>
        )}
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        <div>{formatTime(msg.createdAt)}</div>
        {msg.sentAt && (
          <div className="text-muted-foreground/70">sent {formatTime(msg.sentAt)}</div>
        )}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        {msg.status === "Dead" && (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="retry" />
            <input type="hidden" name="id" value={msg.id} />
            <button
              type="submit"
              disabled={busy}
              className={buttonClasses("primary", "sm")}
            >
              {busy ? "Retrying…" : "Retry"}
            </button>
          </fetcher.Form>
        )}
        {msg.status === "Pending" && (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="cancel" />
            <input type="hidden" name="id" value={msg.id} />
            <button
              type="submit"
              disabled={busy}
              className={buttonClasses("ghost", "sm")}
            >
              {busy ? "Canceling…" : "Cancel"}
            </button>
          </fetcher.Form>
        )}
      </td>
    </tr>
  );
}

export default function AdminOutboundMessages() {
  const { messages, statusFilter, q, counts, total } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(overrides)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    return `?${next.toString()}`;
  }

  const pillLabel = (s: string) =>
    s === "" ? `All ${total}` : `${s} ${counts[s] ?? 0}`;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="flex items-center gap-2">
          <SendHorizonal className="h-6 w-6 text-foreground/80" aria-hidden />
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Outbound Messages
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Transactional outbox — the last 100 rows newest-first.{" "}
          <strong>Retry</strong> resets a Dead row; <strong>Cancel</strong> stops
          a Pending row from sending.
        </p>
      </header>

      {/* Filters */}
      <form method="get" className="flex flex-wrap items-center gap-3">
        {/* Status pill filter */}
        <div className="flex items-center gap-1 text-sm">
          {STATUS_OPTIONS.map((s) => (
            <a
              key={s || "all"}
              href={buildUrl({ status: s, q })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                s === statusFilter
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {pillLabel(s)}
            </a>
          ))}
        </div>

        {/* Text search */}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search target / recipient / event / subject…"
          className="ml-auto min-w-[240px] rounded-md border border-border bg-page px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        <button type="submit" className={buttonClasses("ghost", "sm")}>
          Search
        </button>
      </form>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[900px] text-left">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Channel</th>
              <th className="px-3 py-2">Recipient / Target</th>
              <th className="px-3 py-2">Subject / Event</th>
              <th className="px-3 py-2 text-center">Attempts</th>
              <th className="px-3 py-2">Last error</th>
              <th className="px-3 py-2">Created / Sent</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {messages.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  No messages match this filter.
                </td>
              </tr>
            )}
            {messages.map((msg) => (
              <Row key={msg.id} msg={msg} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground/70">
        Heavy columns (bodyHtml, attachments) are omitted — they are stripped from
        Sent rows after delivery by the retention janitor. Up to 100 rows shown;
        narrow the filter to see older entries.
      </p>
    </div>
  );
}
