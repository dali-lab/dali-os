// Settings → Active sessions. Lists the user's non-revoked Session rows with
// device/IP/last-used metadata and lets them revoke an individual session or
// all others. The current session is flagged but can still be revoked from a
// "sign out everywhere" action (which then redirects to /login on next request).

import { Form, redirect, useNavigation } from "react-router";
import { KeyRound } from "lucide-react";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { prisma } from "~/lib/db";
import type { Route } from "./+types/settings.sessions";

export const meta: Route.MetaFunction = () => [
  { title: "Your devices · Settings · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const rows = await prisma.session.findMany({
    where: {
      userId: auth.user.sub,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      userAgent: true,
      ip: true,
      grantId: true,
      grant: { select: { client: { select: { name: true } } } },
    },
    orderBy: { lastUsedAt: "desc" },
  });

  return {
    currentSessionId: auth.sessionId,
    sessions: rows.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      device: describeUserAgent(s.userAgent),
      userAgent: s.userAgent,
      isDesktop: /DALI OS Desktop/i.test(s.userAgent ?? ""),
      ip: s.ip,
      kind: s.grantId
        ? ({ type: "oauth" as const, clientName: s.grant?.client.name ?? "App" })
        : ({ type: "browser" as const }),
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "revoke-one") {
    const sessionId = form.get("sessionId");
    if (typeof sessionId !== "string") {
      return redirect("/settings/sessions?error=missing_id");
    }
    // Only revoke a session that belongs to this user. Filtering on userId in
    // the updateMany acts as ownership check + revocation in one statement.
    await prisma.session.updateMany({
      where: { id: sessionId, userId: auth.user.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // If the user revoked their current session, requireAuth on the next page
    // load will redirect them to /login. No special handling needed here.
    return redirect("/settings/sessions?revoked=1");
  }

  if (intent === "revoke-others") {
    await prisma.session.updateMany({
      where: {
        userId: auth.user.sub,
        revokedAt: null,
        NOT: { id: auth.sessionId },
      },
      data: { revokedAt: new Date() },
    });
    return redirect("/settings/sessions?revoked=others");
  }

  return redirect("/settings/sessions");
}

export default function SessionsPage({ loaderData }: Route.ComponentProps) {
  const { sessions, currentSessionId } = loaderData;
  const nav = useNavigation();
  const submitting = nav.state !== "idle";
  const otherCount = sessions.filter((s) => s.id !== currentSessionId).length;

  return (
    <main className="max-w-2xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Your devices</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Devices and apps currently signed in to your account — browsers, the
            DALI OS desktop app, and connected tools. Revoking a session signs
            that device out immediately.
          </p>
        </div>
        {otherCount > 0 && (
          <Form method="post">
            <input type="hidden" name="intent" value="revoke-others" />
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50"
            >
              Sign out others ({otherCount})
            </button>
          </Form>
        )}
      </header>

      <section className="mt-6">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <KeyRound className="h-4 w-4" /> Sessions
        </h2>
        {sessions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No active sessions.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {sessions.map((s) => {
              const isCurrent = s.id === currentSessionId;
              return (
                <li
                  key={s.id}
                  className="rounded border border-zinc-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{s.device}</h3>
                        {isCurrent && (
                          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800">
                            This device
                          </span>
                        )}
                        {s.kind.type === "oauth" && (
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                            {s.kind.clientName} (MCP)
                          </span>
                        )}
                        {s.isDesktop && (
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                            Desktop app
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">
                        {s.ip ? <>IP {s.ip} · </> : null}
                        Last used {new Date(s.lastUsedAt).toLocaleString()} ·
                        signed in {new Date(s.createdAt).toLocaleDateString()}
                      </p>
                      {s.userAgent && s.userAgent !== s.device && (
                        <p className="mt-1 truncate font-mono text-[11px] text-zinc-400">
                          {s.userAgent}
                        </p>
                      )}
                    </div>
                    <Form method="post">
                      <input type="hidden" name="intent" value="revoke-one" />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <button
                        type="submit"
                        disabled={submitting}
                        className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {isCurrent ? "Sign out" : "Revoke"}
                      </button>
                    </Form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

// Rough device label from a UA string. Good enough for "this is my MacBook"
// recognition; falls back to "Unknown device" rather than parsing aggressively.
function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";

  // DALI OS native desktop app (Tauri shell) identifies itself explicitly.
  if (/DALI OS Desktop/i.test(ua)) return "DALI OS Desktop";

  // MCP clients usually identify themselves explicitly.
  if (/claude code/i.test(ua)) return "Claude Code";
  if (/^codex\b|codex\//i.test(ua)) return "Codex CLI";
  if (/claude/i.test(ua) && /node\.js|electron/i.test(ua)) return "Claude Desktop";

  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua) && !/Chromium/.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua) && !/Chrome/.test(ua)
          ? "Safari"
          : null;

  const os = /Mac OS X/.test(ua)
    ? "macOS"
    : /Windows NT/.test(ua)
      ? "Windows"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad|iOS/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return "Unknown device";
}
