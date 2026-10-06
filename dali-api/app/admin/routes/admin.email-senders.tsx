// Admin → Email Senders: which Gmail send-as identity backs each outbound
// email purpose (Hiring / Education / Partners / General). Purposes with no
// integration of their own fall back to Hiring, so the page shows both the
// connected state and what actually happens today. Below them, the shared-inbox
// categories for the Email tab (see ~/email/lib/categories.server).
//
// Also exposes per-sender daily cap (GmailIntegration.dailyCap) and today's
// SenderDailyUsage count so operators can see and adjust egress limits.

import { redirect, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useDialog } from "~/components/ui/dialog";
import type { Route } from "./+types/admin.email-senders";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { listSenderIntegrations } from "~/lib/gmail-integration";
import { GMAIL_READONLY_SCOPE } from "~/lib/google-oauth";
import { buttonClasses } from "~/components/ui/Button";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { UsageGauge } from "~/admin/components/console-ui";
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

export const handle = adminHandle("email-senders");

export const meta: Route.MetaFunction = () => [
  { title: "Email Senders · Admin · DALI OS" },
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
    // Soft-disable, matching the model's convention — the row (and its token)
    // stays for re-enable via reconnect.
    await prisma.gmailIntegration.update({ where: { id }, data: { enabled: false } });
    return Response.json({ ok: true });
  }

  if (intent === "save-cap") {
    const id = form.get("id");
    const capRaw = form.get("dailyCap");
    if (typeof id !== "string" || !id) {
      return Response.json({ error: "Invalid input" }, { status: 400 });
    }
    // Empty string or "0" → null (uncapped); positive integer → cap value.
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

function DailyCapRow({
  integrationId,
  dailyCap,
  todayCount,
  capped,
}: {
  integrationId: string;
  dailyCap: number | null;
  todayCount: number;
  capped: boolean;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const busy = fetcher.state !== "idle";

  return (
    <div className="mt-3 border-t border-border pt-3">
      {/* Usage gauge — spans full width */}
      <UsageGauge value={todayCount} max={dailyCap} />

      {/* Today's usage indicator + cap editor */}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          Today:{" "}
          <span className={capped ? "font-semibold text-red-600" : "font-medium text-foreground"}>
            {todayCount}
          </span>
          {dailyCap != null ? ` / ${dailyCap}` : ""}
          {capped && (
            <Tooltip content="This sender has reached its daily cap — outbound email for this purpose is paused until midnight UTC." variant="rich">
              <span className="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 cursor-default">
                capped
              </span>
            </Tooltip>
          )}
        </span>

        {/* Cap editor */}
        <fetcher.Form method="post" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="intent" value="save-cap" />
          <input type="hidden" name="id" value={integrationId} />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Daily cap
            <InfoTip content="Maximum emails this sender may send per UTC day. Leave blank for uncapped. The gauge above shows today's usage." />
            <input
              type="number"
              name="dailyCap"
              min={1}
              defaultValue={dailyCap ?? ""}
              placeholder="uncapped"
              className="w-24 rounded-md border border-border bg-page px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className={buttonClasses("ghost", "sm")}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {fetcher.data?.error && (
            <span className="text-xs text-red-600">{fetcher.data.error}</span>
          )}
          {fetcher.data?.ok && (
            <span className="text-xs text-emerald-600">Saved</span>
          )}
        </fetcher.Form>
      </div>
    </div>
  );
}

type SenderInfo = ReturnType<typeof useLoaderData<typeof loader>>["senders"][number];

// One automated-email sender: the Gmail account DALI OS sends this area's mail
// from (interview invites, partner invites, digests, sign-in links …).
function SenderRow({ sender: s }: { sender: SenderInfo }) {
  const fetcher = useFetcher();
  const dialog = useDialog();

  const disable = async () => {
    const fallback = s.fallbackEmail ?? (s.purpose !== "Hiring" ? "the Hiring sender" : null);
    const fallbackNote = fallback
      ? ` Outbound email for ${s.label} will silently fall back to ${fallback}.`
      : " No fallback is configured — outbound email for this purpose will stop until reconnected.";
    const ok = await dialog.confirm({
      title: `Disable ${s.label} sender (${s.sendAsEmail})?`,
      description: `This soft-disables the send-as identity.${fallbackNote}`,
      tone: "destructive",
      confirmLabel: "Disable",
    });
    if (ok) fetcher.submit({ intent: "disable", id: s.integrationId! }, { method: "post" });
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-40 text-sm font-medium text-foreground">{s.label}</span>
        <span className="text-sm text-muted-foreground">
          {s.sendAsEmail
            ? `Sent as ${s.sendAsEmail}`
            : s.fallbackEmail
              ? `Not set up — sent as ${s.fallbackEmail} for now`
              : "Not set up"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <a href={`/admin/authorize-gmail?purpose=${s.purpose}`} className={buttonClasses("secondary", "sm")}>
            {s.sendAsEmail ? "Reconnect" : "Connect"}
          </a>
          {s.integrationId && (
            <button type="button" onClick={disable} className={buttonClasses("ghost", "sm")}>
              Disable
            </button>
          )}
        </span>
      </div>
      {s.sendAsEmail && (
        <p className="mt-1 text-xs text-muted-foreground">
          Connected {formatTime(s.linkedAt)} · last used {formatTime(s.lastUsedAt)}
          {s.readsInbox ? " · reads inbox" : ""}
          {s.syncError ? ` · error: ${s.syncError}` : ""}
        </p>
      )}
      {s.sendAsEmail && s.purpose === "Hiring" && !s.readsInbox && (
        <p className="mt-1 text-xs text-muted-foreground">
          Reconnect to grant inbox read access. The applicant email index and thread viewer use it
          instead of a member's own sign-in.
        </p>
      )}
      {s.integrationId && (
        <DailyCapRow
          integrationId={s.integrationId}
          dailyCap={s.dailyCap}
          todayCount={s.todayCount}
          capped={s.capped}
        />
      )}
    </li>
  );
}

export default function EmailSendersAdmin() {
  const { senders, inboxCategories, isAdmin: canEdit } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const justAuthorized = params.get("gmail_authorized") === "1";
  const gmailError = params.get("gmail_error");
  const { pageTitle, card, cardPad, sectionTitle, bodyText } = useOsChrome();
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className={pageTitle}>Email Senders</h1>
      </header>

      {justAuthorized && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Account connected.
        </p>
      )}
      {gmailError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Connecting failed ({gmailError}). Try again.
        </p>
      )}

      <InboxCategoriesSection data={inboxCategories} canEdit={canEdit} />

      <section className="mt-6 flex flex-col gap-3">
        <h2 className={sectionTitle}>Automated email</h2>
        <p className={bodyText}>
          The Gmail account DALI OS sends each area&apos;s automatic mail from: interview invites and decisions,
          partner invites, notification digests and sign-in links. Unrelated to the categories above.
        </p>
        <ul className={cn(card, cardPad, "divide-y divide-border py-1")}>
          {senders.map((s) => (
            <SenderRow key={s.purpose} sender={s} />
          ))}
        </ul>
      </section>
    </div>
  );
}
