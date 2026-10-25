// Transactional outbox viewer: recent OutboundMessage rows with status filter
// and text search. Heavy columns (bodyHtml, attachments) are left out: the
// retention janitor zeroes them after send and they don't help triage.

import { useEffect, useState } from "react";
import { Form, redirect, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { ChevronDown, Hash, Mail, RotateCw, X } from "lucide-react";
import type { Route } from "./+types/admin.outbound-messages";
import type { Prisma } from "~/generated/prisma/client";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { EmptyState, Pill, type Tone } from "~/admin/components/console-ui";
import { SearchInput } from "~/components/ui/SearchInput";
import { Segmented } from "~/components/ui/Segmented";
import { Tooltip } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { fullName } from "~/lib/display";

export const handle = adminHandle("outbox");

export const meta: Route.MetaFunction = () => [{ title: "Outbox · Admin · DALI OS" }];

const STATUSES = ["Pending", "Sending", "Sent", "Dead", "Canceled"] as const;
const ROW_LIMIT = 100;

export function outboxSearchWhere(q: string): Prisma.OutboundMessageWhereInput {
  if (!q) return {};
  const contains = { contains: q, mode: "insensitive" as const };
  return {
    OR: [{ target: contains }, { recipientUserId: contains }, { eventType: contains }, { subject: contains }],
  };
}

function retryData() {
  return { status: "Pending", nextAttemptAt: new Date(), attempts: 0, lastError: null };
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const search = outboxSearchWhere(q);

  // Counts honor the search but not the status filter, so every segment shows its true size.
  const grouped = await prisma.outboundMessage.groupBy({ by: ["status"], where: search, _count: true });
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const rows = await prisma.outboundMessage.findMany({
    where: { ...(statusFilter ? { status: statusFilter } : {}), ...search },
    orderBy: { createdAt: "desc" },
    take: ROW_LIMIT,
    select: {
      id: true,
      channel: true,
      status: true,
      purpose: true,
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
    return {
      id: r.id,
      channel: r.channel,
      status: r.status,
      purpose: r.purpose,
      target: r.target,
      recipientName: u ? fullName(u) || u.daliEmail : null,
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

  if (intent === "retry-all") {
    const q = String(form.get("q") ?? "").trim();
    const { count } = await prisma.outboundMessage.updateMany({
      where: { status: "Dead", ...outboxSearchWhere(q) },
      data: retryData(),
    });
    if (count > 0) {
      await logAuditEvent({
        action: "outbound.retry_all",
        userId: auth.user.sub,
        metadata: { count, search: q || null },
        request,
      });
    }
    return Response.json({ ok: true, count });
  }

  const id = form.get("id");
  if (typeof id !== "string" || !id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  if (intent === "retry") {
    const message = await prisma.outboundMessage.update({
      where: { id, status: "Dead" },
      data: retryData(),
      select: { channel: true, purpose: true },
    });
    await logAuditEvent({
      action: "outbound.retry",
      userId: auth.user.sub,
      targetId: id,
      metadata: { channel: message.channel, purpose: message.purpose },
      request,
    });
    return Response.json({ ok: true });
  }

  if (intent === "cancel") {
    const message = await prisma.outboundMessage.update({
      where: { id, status: { in: ["Pending", "Dead"] } },
      data: { status: "Canceled" },
      select: { channel: true, purpose: true },
    });
    await logAuditEvent({
      action: "outbound.cancel",
      userId: auth.user.sub,
      targetId: id,
      metadata: { channel: message.channel, purpose: message.purpose },
      request,
    });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Invalid intent" }, { status: 400 });
}

// ─── UI ────────────────────────────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_VIEW: Record<string, { tone: Tone; label: string }> = {
  Pending: { tone: "warn", label: "Pending" },
  Sending: { tone: "warn", label: "Sending" },
  Sent: { tone: "ok", label: "Sent" },
  Dead: { tone: "bad", label: "Failed" },
  Canceled: { tone: "idle", label: "Canceled" },
};

const statusView = (s: string) => STATUS_VIEW[s] ?? { tone: "idle" as const, label: s };

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  slack_dm: "Slack DM",
  slack_channel: "Slack channel",
};

type MessageRow = ReturnType<typeof useLoaderData<typeof loader>>["messages"][number];

function Detail({ term, value, mono }: { term: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-os-muted">{term}</dt>
      <dd className={cn("break-all text-foreground", mono && "font-mono text-xs leading-5")}>{value}</dd>
    </div>
  );
}

function MessageItem({ msg, open, onToggle }: { msg: MessageRow; open: boolean; onToggle: () => void }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const dialog = useDialog();
  const { actionBtn, actionBtnPrimary } = useOsChrome();
  const busy = fetcher.state !== "idle";
  const pendingIntent = fetcher.formData?.get("intent");
  const view = statusView(msg.status);
  const ChannelIcon = msg.channel === "email" ? Mail : Hash;
  const title = msg.subject ?? msg.eventType ?? "No subject";
  const recipient = msg.recipientName ?? msg.target;

  async function cancel() {
    const failed = msg.status === "Dead";
    const ok = await dialog.confirm({
      title: failed ? "Cancel this failed message?" : "Cancel this queued message?",
      description: failed
        ? "It stays in the outbox as canceled and can't be retried. Whatever triggered it would have to run again."
        : "It won't be delivered, and the queue won't retry it. Whatever triggered it would have to run again.",
      confirmLabel: "Cancel message",
      cancelLabel: failed ? "Keep it" : "Leave it queued",
      tone: "destructive",
    });
    if (ok) fetcher.submit({ intent: "cancel", id: msg.id }, { method: "post" });
  }

  return (
    <li className="border-t border-os-container/70 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-4 px-5 py-4 text-left sm:px-6"
      >
        <Tooltip content={CHANNEL_LABEL[msg.channel] ?? msg.channel}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-os-item bg-os-well text-os-grey">
            <ChannelIcon className="h-4 w-4" aria-label={CHANNEL_LABEL[msg.channel] ?? msg.channel} />
          </span>
        </Tooltip>
        <span className="min-w-0 flex-1">
          <Tooltip content={title}>
            <span className="block truncate font-semibold text-foreground">{title}</span>
          </Tooltip>
          <span className="block truncate text-sm text-os-grey">
            {recipient}
            <span className="text-os-muted">
              {msg.subject && msg.eventType ? ` · ${msg.eventType}` : ""} · {formatTime(msg.createdAt)}
              {msg.sentAt ? ` · sent ${formatTime(msg.sentAt)}` : ""}
            </span>
          </span>
          {msg.lastError && !open && (
            <Tooltip content={msg.lastError} variant="rich" placement="bottom">
              <span className="mt-1 block truncate font-mono text-xs text-destructive">
                {msg.lastError.length > 120 ? `${msg.lastError.slice(0, 120)}…` : msg.lastError}
              </span>
            </Tooltip>
          )}
        </span>
        <span className="hidden text-xs tabular-nums text-os-muted md:block">
          {msg.attempts} {msg.attempts === 1 ? "attempt" : "attempts"}
        </span>
        <Pill tone={view.tone} className="hidden sm:inline-flex">
          {view.label}
        </Pill>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-os-muted transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="mx-5 mb-5 flex flex-col gap-4 rounded-os-item bg-os-well p-4 sm:mx-6 sm:ml-[76px]">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <Detail term="Channel" value={CHANNEL_LABEL[msg.channel] ?? msg.channel} />
              <Detail term="Attempts" value={String(msg.attempts)} />
              <Detail term="Purpose" value={msg.purpose ?? "—"} />
              <Detail term="Status" value={view.label} />
              <Detail term="Target" value={msg.target} mono />
              <Detail term="Event" value={msg.eventType ?? "—"} mono />
              <Detail term="Created" value={formatTime(msg.createdAt)} />
              <Detail term="Sent" value={formatTime(msg.sentAt)} />
            </dl>
            {msg.lastError && (
              <p className="break-all rounded-lg bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
                {msg.lastError}
              </p>
            )}
            {fetcher.data?.error && <p className="text-xs text-destructive">{fetcher.data.error}</p>}
            {(msg.status === "Dead" || msg.status === "Pending") && (
              <div className="flex flex-wrap gap-2">
                {msg.status === "Dead" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fetcher.submit({ intent: "retry", id: msg.id }, { method: "post" })}
                    className={cn(actionBtnPrimary, "disabled:opacity-50")}
                  >
                    <RotateCw className="h-4 w-4" />
                    {pendingIntent === "retry" ? "Retrying…" : "Retry"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void cancel()}
                  className={cn(actionBtn(), "disabled:opacity-50")}
                >
                  <X className="h-4 w-4" />
                  {pendingIntent === "cancel" ? "Canceling…" : "Cancel send"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function RetryAllButton({ count, q }: { count: number; q: string }) {
  const fetcher = useFetcher<{ ok?: boolean; count?: number; error?: string }>();
  const dialog = useDialog();
  const toast = useToast();
  const { actionBtnPrimary } = useOsChrome();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) toast.error(fetcher.data.error);
    else if (fetcher.data.ok) {
      const n = fetcher.data.count ?? 0;
      toast.success(n === 1 ? "1 message re-queued." : `${n} messages re-queued.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  async function retryAll() {
    const ok = await dialog.confirm({
      title: `Retry ${count} failed ${count === 1 ? "message" : "messages"}?`,
      description: q
        ? `Every failed message matching "${q}" goes back in the queue and sends on the next drain.`
        : "Every failed message goes back in the queue and sends on the next drain.",
      confirmLabel: "Retry all",
    });
    if (ok) fetcher.submit({ intent: "retry-all", q }, { method: "post" });
  }

  return (
    <button
      type="button"
      disabled={fetcher.state !== "idle"}
      onClick={() => void retryAll()}
      className={cn(actionBtnPrimary, "disabled:opacity-50")}
    >
      <RotateCw className="h-4 w-4" />
      {fetcher.state !== "idle" ? "Retrying…" : "Retry all failed"}
    </button>
  );
}

type StatusFilter = "" | (typeof STATUSES)[number];

export default function AdminOutboundMessages() {
  const { messages, statusFilter, q, counts, total } = useLoaderData<typeof loader>();
  const { panel, actionBtn } = useOsChrome();
  const [, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const failed = counts.Dead ?? 0;

  function onStatusChange(next: StatusFilter) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next) params.set("status", next);
      else params.delete("status");
      return params;
    });
  }

  const filterLabel = statusFilter ? statusView(statusFilter).label.toLowerCase() : "";

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader section="messaging" />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-full overflow-x-auto">
          <Segmented<StatusFilter>
            ariaLabel="Message status"
            value={(statusFilter as StatusFilter) || ""}
            onChange={onStatusChange}
            options={[
              { value: "", label: "All", count: total },
              ...STATUSES.map((s) => ({ value: s, label: statusView(s).label, count: counts[s] ?? 0 })),
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Form method="get" role="search" className="flex items-center gap-2">
            <SearchInput
              size="sm"
              name="q"
              defaultValue={q}
              aria-label="Search messages"
              placeholder="Search target, recipient, event, subject"
              containerClassName="min-w-[240px] sm:w-72"
            />
            {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
            <button type="submit" className={actionBtn()}>
              Search
            </button>
          </Form>
          {failed > 0 && (statusFilter === "" || statusFilter === "Dead") && (
            <RetryAllButton count={failed} q={q} />
          )}
        </div>
      </div>

      <ul className={panel}>
        {messages.map((m) => (
          <MessageItem
            key={m.id}
            msg={m}
            open={open === m.id}
            onToggle={() => setOpen((cur) => (cur === m.id ? null : m.id))}
          />
        ))}
        {messages.length === 0 && (
          <li>
            <EmptyState title="Nothing here">
              {q
                ? "No messages match this filter."
                : `No ${filterLabel ? `${filterLabel} ` : ""}messages.`}
            </EmptyState>
          </li>
        )}
      </ul>

      <p className="text-xs text-os-muted">
        Newest first, up to {ROW_LIMIT} rows. Narrow the filter to see older ones. Message bodies and attachments
        aren&apos;t shown; they are cleared from sent messages after delivery.
      </p>
    </div>
  );
}
