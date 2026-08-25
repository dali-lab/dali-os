// Admin → Email Senders: which Gmail send-as identity backs each outbound
// email purpose (Hiring / Education / Partners / General). Purposes with no
// integration of their own fall back to Hiring, so the page shows both the
// connected state and what actually happens today.
//
// Also exposes per-sender daily cap (GmailIntegration.dailyCap) and today's
// SenderDailyUsage count so operators can see and adjust egress limits.

import { redirect, useFetcher, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/admin.email-senders";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { listSenderIntegrations } from "~/lib/gmail-integration";
import { buttonClasses } from "~/components/ui/Button";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { UsageGauge } from "~/admin/components/console-ui";
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
      dailyCap,
      todayCount,
      capped: dailyCap != null && todayCount >= dailyCap,
      // What actually sends when this purpose has no row of its own.
      fallbackEmail: !row && purpose !== "Hiring" ? (hiring?.sendAsEmail ?? null) : null,
    };
  });

  const admin = await isAdmin(auth.user.sub);
  return { senders, isAdmin: admin };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const intent = form.get("intent");

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
            <span className="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
              capped
            </span>
          )}
        </span>

        {/* Cap editor */}
        <fetcher.Form method="post" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="intent" value="save-cap" />
          <input type="hidden" name="id" value={integrationId} />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Daily cap
            <input
              type="number"
              name="dailyCap"
              min={1}
              defaultValue={dailyCap ?? ""}
              placeholder="uncapped"
              className="w-24 rounded-md border border-border bg-page px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              title="Maximum emails per UTC day. Leave blank for uncapped."
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

export default function EmailSendersAdmin() {
  const { senders } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [params] = useSearchParams();
  const justAuthorized = params.get("gmail_authorized") === "1";
  const gmailError = params.get("gmail_error");
  const { os, pageTitle, cardPad } = useOsChrome();

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

      <div className="space-y-4">
        {senders.map((s) => (
          <div
            key={s.purpose}
            className={cn(
              cardPad,
              os ? "rounded-os-card bg-os-card" : "rounded-lg border border-border bg-card",
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{s.label}</span>
                  {s.sendAsEmail ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      {s.sendAsEmail}
                    </span>
                  ) : s.fallbackEmail ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      falls back to {s.fallbackEmail}
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      not connected
                    </span>
                  )}
                </div>
                {s.sendAsEmail && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Connected {formatTime(s.linkedAt)} · last used{" "}
                    {formatTime(s.lastUsedAt)}
                    {s.syncError ? ` · error: ${s.syncError}` : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <a
                  href={`/admin/authorize-gmail?purpose=${s.purpose}`}
                  className={os ? "os-btn-primary" : buttonClasses("primary", "sm")}
                >
                  {s.sendAsEmail ? "Reconnect" : "Connect"}
                </a>
                {s.integrationId && (
                  <button
                    onClick={() =>
                      fetcher.submit(
                        { intent: "disable", id: s.integrationId! },
                        { method: "post" },
                      )
                    }
                    className={os ? "os-btn-ghost" : buttonClasses("ghost", "sm")}
                  >
                    Disable
                  </button>
                )}
              </div>
            </div>

            {/* Daily cap + today's usage — only shown for connected senders */}
            {s.integrationId && (
              <DailyCapRow
                integrationId={s.integrationId}
                dailyCap={s.dailyCap}
                todayCount={s.todayCount}
                capped={s.capped}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
