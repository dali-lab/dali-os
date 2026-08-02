// Admin → Email Senders: which Gmail send-as identity backs each outbound
// email purpose (Hiring / Education / Partners / General). Purposes with no
// integration of their own fall back to Hiring, so the page shows both the
// connected state and what actually happens today.

import { redirect, useFetcher, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/admin.email-senders";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isAdmin } from "~/lib/roles";
import { listSenderIntegrations } from "~/lib/gmail-integration";
import { buttonClasses } from "~/components/ui/Button";
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
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const rows = await listSenderIntegrations();
  const byPurpose = new Map<string, (typeof rows)[number]>();
  // Newest-first list: resolution uses the newest enabled row per purpose,
  // so first-seen wins here too.
  for (const row of rows) {
    if (row.enabled && !byPurpose.has(row.purpose)) byPurpose.set(row.purpose, row);
  }

  const senders = EMAIL_PURPOSE_KEYS.map((purpose) => {
    const row = byPurpose.get(purpose);
    const hiring = byPurpose.get("Hiring");
    return {
      purpose,
      label: EMAIL_PURPOSES[purpose].label,
      description: EMAIL_PURPOSES[purpose].description,
      integrationId: row?.id ?? null,
      sendAsEmail: row?.sendAsEmail ?? null,
      linkedAt: row?.linkedAt?.toISOString() ?? null,
      lastUsedAt: row?.lastUsedAt?.toISOString() ?? null,
      syncError: row?.syncError ?? null,
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
  const id = form.get("id");
  if (intent !== "disable" || typeof id !== "string" || !id) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  // Soft-disable, matching the model's convention — the row (and its token)
  // stays for re-enable via reconnect.
  await prisma.gmailIntegration.update({ where: { id }, data: { enabled: false } });
  return Response.json({ ok: true });
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

export default function EmailSendersAdmin() {
  const { senders } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [params] = useSearchParams();
  const justAuthorized = params.get("gmail_authorized") === "1";
  const gmailError = params.get("gmail_error");

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Email Senders
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each area's outbound email sends from its own connected Google
          account. Areas without their own account fall back to the Hiring
          (applications@) sender until one is connected.
        </p>
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
            className="rounded-lg border border-zinc-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-900">{s.label}</span>
                  {s.sendAsEmail ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      {s.sendAsEmail}
                    </span>
                  ) : s.fallbackEmail ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      falls back to {s.fallbackEmail}
                    </span>
                  ) : (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      not connected
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-zinc-600">{s.description}</p>
                {s.sendAsEmail && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Connected {formatTime(s.linkedAt)} · last used{" "}
                    {formatTime(s.lastUsedAt)}
                    {s.syncError ? ` · error: ${s.syncError}` : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <a
                  href={`/admin/authorize-gmail?purpose=${s.purpose}`}
                  className={buttonClasses("primary", "sm")}
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
                    className={buttonClasses("ghost", "sm")}
                  >
                    Disable
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
