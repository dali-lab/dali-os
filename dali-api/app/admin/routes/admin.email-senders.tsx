// Which Gmail send-as identity backs each outbound email purpose. Purposes
// with no integration of their own fall back to Hiring, so the page shows both
// the connected state and what actually happens today. Below them, the
// shared-inbox categories for the Email tab (see ~/email/lib/categories.server).

import { redirect, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { PowerOff } from "lucide-react";
import { useDialog } from "~/components/ui/dialog";
import type { Route } from "./+types/admin.email-senders";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { listSenderIntegrations } from "~/lib/gmail-integration";
import { GMAIL_READONLY_SCOPE } from "~/lib/google-oauth";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { Pill, UsageGauge, usageTone, type Tone } from "~/admin/components/console-ui";
import { InfoTip, Tooltip } from "~/components/ui/floating";
import { InboxCategoriesSection } from "~/email/components/InboxCategoriesSection";
import {
  CATEGORY_INTENTS,
  handleInboxCategoryAction,
  loadInboxCategories,
} from "~/email/lib/categories.server";
import {
  EMAIL_PURPOSES,
  EMAIL_PURPOSE_KEYS,
  type EmailPurposeKey,
} from "~/lib/email-identities";

export const handle = adminHandle("senders");

export const meta: Route.MetaFunction = () => [
  { title: "Senders & inboxes · Admin · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const rows = await listSenderIntegrations();
  const byPurpose = new Map<string, (typeof rows)[number]>();
  // Newest-first list: resolution uses the newest enabled row per purpose,
  // so first-seen wins here too.
  for (const row of rows) {
    if (row.enabled && !byPurpose.has(row.purpose)) byPurpose.set(row.purpose, row);
  }

  // Today's usage for each connected sender (by id, not purpose).
  const todayUtc = new Date().toISOString().slice(0, 10);
  const connectedIds = [...byPurpose.values()].map((r) => r.id);
  const usageRows =
    connectedIds.length === 0
      ? []
      : await prisma.senderDailyUsage.findMany({
          where: {
            senderId: { in: connectedIds },
            day: todayUtc,
          },
          select: { senderId: true, count: true },
        });
  const usageById = new Map(usageRows.map((u) => [u.senderId, u.count]));

  const senders = EMAIL_PURPOSE_KEYS.map((purpose) => {
    const row = byPurpose.get(purpose);
    const hiring = byPurpose.get("Hiring");
    const todayCount = row ? (usageById.get(row.id) ?? 0) : 0;
    const dailyCap = row?.dailyCap ?? null;
    return {
      purpose,
      label: EMAIL_PURPOSES[purpose].label,
      description: EMAIL_PURPOSES[purpose].description,
      integrationId: row?.id ?? null,
      sendAsEmail: row?.sendAsEmail ?? null,
      linkedAt: row?.linkedAt?.toISOString() ?? null,
      lastUsedAt: row?.lastUsedAt?.toISOString() ?? null,
      syncError: row?.syncError ?? null,
      readsInbox: row?.scopes.includes(GMAIL_READONLY_SCOPE) ?? false,
      dailyCap,
      todayCount,
      capped: dailyCap != null && todayCount >= dailyCap,
      // What actually sends when this purpose has no row of its own.
      fallbackEmail: !row && purpose !== "Hiring" ? (hiring?.sendAsEmail ?? null) : null,
    };
  });

  const [admin, inboxCategories] = await Promise.all([isAdmin(auth.user.sub), loadInboxCategories()]);
  return { senders, inboxCategories, isAdmin: admin };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const intent = form.get("intent");

  if ((CATEGORY_INTENTS as readonly unknown[]).includes(intent)) {
    if (!(await isAdmin(auth.user.sub))) {
      return Response.json({ error: "Only admins can change shared inbox categories." }, { status: 403 });
    }
    return handleInboxCategoryAction(request, form, auth.user.sub);
  }

  if (intent === "disable") {
    const id = form.get("id");
    if (typeof id !== "string" || !id) {
      return Response.json({ error: "Invalid input" }, { status: 400 });
    }
    // Soft-disable: the row and its token stay so a reconnect re-enables it.
    await prisma.gmailIntegration.update({ where: { id }, data: { enabled: false } });
    return Response.json({ ok: true });
  }

  if (intent === "save-cap") {
    const id = form.get("id");
    const capRaw = form.get("dailyCap");
    if (typeof id !== "string" || !id) {
      return Response.json({ error: "Invalid input" }, { status: 400 });
    }
    const cap =
      typeof capRaw === "string" && capRaw.trim() !== "" && Number(capRaw) > 0
        ? Number(capRaw)
        : null;
    await prisma.gmailIntegration.update({ where: { id }, data: { dailyCap: cap } });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Invalid intent" }, { status: 400 });
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const PCT_CLASS: Record<Tone, string> = {
  ok: "text-os-muted",
  idle: "text-os-muted",
  warn: "text-os-amber",
  bad: "text-destructive",
};

function DailyUsage({
  integrationId,
  label,
  dailyCap,
  todayCount,
  capped,
}: {
  integrationId: string;
  label: string;
  dailyCap: number | null;
  todayCount: number;
  capped: boolean;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const { compactField, actionBtn } = useOsChrome();
  const busy = fetcher.state !== "idle";
  const pct = dailyCap ? Math.round((todayCount / dailyCap) * 100) : null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="tabular-nums text-foreground">
          {todayCount.toLocaleString()}{" "}
          <span className="text-os-muted">
            {dailyCap != null ? `/ ${dailyCap.toLocaleString()} today` : "today, uncapped"}
          </span>
        </span>
        {capped ? (
          <Tooltip
            content="This sender has reached its daily cap. Outbound email for this purpose is paused until midnight UTC."
            variant="rich"
          >
            <span className="cursor-default">
              <Pill tone="bad">Capped</Pill>
            </span>
          </Tooltip>
        ) : (
          pct != null && (
            <span className={cn("text-xs tabular-nums", PCT_CLASS[usageTone(todayCount, dailyCap)])}>{pct}%</span>
          )
        )}
      </div>
      <UsageGauge value={todayCount} max={dailyCap} />
      <fetcher.Form method="post" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="intent" value="save-cap" />
        <input type="hidden" name="id" value={integrationId} />
        <label className="flex items-center gap-1.5 text-xs text-os-grey">
          Daily cap
          <InfoTip content="Maximum emails this sender may send per UTC day. Leave blank for uncapped." />
          <input
            type="number"
            name="dailyCap"
            min={1}
            defaultValue={dailyCap ?? ""}
            placeholder="Uncapped"
            aria-label={`${label} daily cap`}
            className={cn(compactField, "w-24 border border-os-container px-2 py-1 text-xs tabular-nums")}
          />
        </label>
        <button type="submit" disabled={busy} className={cn(actionBtn(), "px-2.5 py-1 text-xs disabled:opacity-50")}>
          {busy ? "Saving…" : "Save"}
        </button>
        {fetcher.data?.error && <span className="text-xs text-destructive">{fetcher.data.error}</span>}
        {fetcher.data?.ok && !busy && <span className="text-xs text-os-green">Saved</span>}
      </fetcher.Form>
    </div>
  );
}

type SenderInfo = ReturnType<typeof useLoaderData<typeof loader>>["senders"][number];

function senderState(s: SenderInfo): { tone: Tone; label: string } {
  if (!s.sendAsEmail) return { tone: "idle", label: "Not set up" };
  if (s.syncError) return { tone: "bad", label: "Error" };
  if (s.capped) return { tone: "warn", label: "Capped" };
  return { tone: "ok", label: "Connected" };
}

// One automated-email sender: the Gmail account DALI OS sends this area's mail
// from (interview invites, partner invites, digests, sign-in links).
function SenderRow({ sender: s }: { sender: SenderInfo }) {
  const fetcher = useFetcher();
  const dialog = useDialog();
  const { actionBtn, actionBtnPrimary, iconBtn } = useOsChrome();
  const state = senderState(s);

  const disable = async () => {
    const fallback = s.fallbackEmail ?? (s.purpose !== "Hiring" ? "the Hiring sender" : null);
    const fallbackNote = fallback
      ? ` Outbound email for ${s.label} will silently fall back to ${fallback}.`
      : " No fallback is configured, so outbound email for this purpose stops until it is reconnected.";
    const ok = await dialog.confirm({
      title: `Disable ${s.label} sender (${s.sendAsEmail})?`,
      description: `This soft-disables the send-as identity.${fallbackNote}`,
      tone: "destructive",
      confirmLabel: "Disable",
    });
    if (ok) fetcher.submit({ intent: "disable", id: s.integrationId! }, { method: "post" });
  };

  return (
    <li className="grid items-start gap-4 border-t border-os-container/70 px-6 py-5 first:border-t-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-foreground">{s.label}</p>
          <Pill tone={state.tone}>{state.label}</Pill>
        </div>
        <p className="mt-0.5 text-sm text-os-grey">{s.description}</p>
        {s.sendAsEmail ? (
          <p className="mt-1 truncate font-mono text-xs text-os-muted">{s.sendAsEmail}</p>
        ) : (
          s.fallbackEmail && <p className="mt-1 truncate text-xs text-os-muted">Sent as {s.fallbackEmail} for now</p>
        )}
        {s.sendAsEmail && (
          <p className="mt-1 text-xs text-os-muted">
            Connected {formatTime(s.linkedAt)} · last used {formatTime(s.lastUsedAt)}
            {s.readsInbox ? " · reads inbox" : ""}
          </p>
        )}
        {s.syncError && (
          <p className="mt-2 break-all rounded-lg bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
            {s.syncError}
          </p>
        )}
        {s.sendAsEmail && s.purpose === "Hiring" && !s.readsInbox && (
          <p className="mt-2 text-xs text-os-grey">
            Reconnect to grant inbox read access. The applicant email index and thread viewer use it instead of a
            member&apos;s own sign-in.
          </p>
        )}
      </div>
      <div className="min-w-0">
        {s.integrationId ? (
          <DailyUsage
            integrationId={s.integrationId}
            label={s.label}
            dailyCap={s.dailyCap}
            todayCount={s.todayCount}
            capped={s.capped}
          />
        ) : (
          <p className="text-sm text-os-muted">
            {s.fallbackEmail ? "Falls back to the Hiring sender." : "Connect an account to send this mail."}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 md:justify-end">
        <a
          href={`/admin/authorize-gmail?purpose=${s.purpose}`}
          className={s.sendAsEmail ? actionBtn() : actionBtnPrimary}
        >
          {s.sendAsEmail ? "Reconnect" : "Connect"}
        </a>
        {s.integrationId && (
          <Tooltip content="Disable">
            <button
              type="button"
              onClick={disable}
              disabled={fetcher.state !== "idle"}
              aria-label={`Disable ${s.label} sender`}
              className={cn(iconBtn, "ml-1 disabled:opacity-50")}
            >
              <PowerOff className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>
    </li>
  );
}

export default function EmailSendersAdmin() {
  const { senders, inboxCategories, isAdmin: canEdit } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const justAuthorized = params.get("gmail_authorized") === "1";
  const gmailError = params.get("gmail_error");
  const { panel, sectionTitle, bodyText } = useOsChrome();
  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader section="messaging" />

      {justAuthorized && (
        <p role="status" className="rounded-os-item bg-os-green/10 px-4 py-3 text-sm text-os-green">
          Account connected.
        </p>
      )}
      {gmailError && (
        <p role="alert" className="rounded-os-item bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Connecting failed ({gmailError}). Try again.
        </p>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="senders-title">
        <div>
          <h2 id="senders-title" className={sectionTitle}>
            Send-as accounts
          </h2>
          <p className={cn(bodyText, "mt-1")}>
            The Gmail account DALI OS sends each area&apos;s automatic mail from: interview invites and decisions,
            partner invites, notification digests and sign-in links. Unrelated to the inbox categories below.
          </p>
        </div>
        <ul className={panel}>
          {senders.map((s) => (
            <SenderRow key={s.purpose} sender={s} />
          ))}
        </ul>
      </section>

      <InboxCategoriesSection data={inboxCategories} canEdit={canEdit} />
    </div>
  );
}
