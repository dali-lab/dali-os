// Settings → Slack. Lets a member connect their Slack account so DALI OS knows
// their Slack user id (used to invite them to project channels at staffing
// finalize). We resolve the id from their email via the bot token's
// users.lookupByEmail — no per-user OAuth app exists — so "Connect" works only
// when the member's Slack account uses one of their emails on file.

import { redirect, useFetcher } from "react-router";
import { Slack, CheckCircle2, Trash2 } from "lucide-react";
import { requireAuth, unauthorized, forbidden, redirectPartnerToPortal, isPartnerAccount } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { lookupSlackUserByEmail } from "~/slack/lib/slack-client";
import { logAuditEvent } from "~/lib/audit";
import type { Route } from "./+types/settings.slack";

export const meta: Route.MetaFunction = () => [{ title: "Slack · Settings · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const user = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { slackUserId: true, daliEmail: true, dartmouthEmail: true, personalEmail: true },
  });

  const emails = [user?.daliEmail, user?.dartmouthEmail, user?.personalEmail].filter(
    (e): e is string => !!e,
  );

  return {
    slackUserId: user?.slackUserId ?? null,
    // Whether the lookup is even possible / configured, shown as a hint.
    configured: !!process.env.SLACK_BOT_TOKEN,
    emails,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  if (auth.user.type === "applicant")
    return forbidden(request);
  if (await isPartnerAccount(auth)) return forbidden(request);

  const userId = auth.user.sub;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "disconnect") {
    await prisma.user.update({ where: { id: userId }, data: { slackUserId: null } });
    await logAuditEvent({
      action: "slack.disconnect",
      userId,
      targetId: userId,
      metadata: {},
      request,
    });
    return { ok: true, slackUserId: null, error: null };
  }

  if (intent === "connect") {
    if (!process.env.SLACK_BOT_TOKEN) {
      return { ok: false, slackUserId: null, error: "Slack isn't configured on the server." };
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { daliEmail: true, dartmouthEmail: true, personalEmail: true },
    });
    const emails = [user?.daliEmail, user?.dartmouthEmail, user?.personalEmail].filter(
      (e): e is string => !!e,
    );

    // Try each email until Slack resolves an account.
    let slackId: string | null = null;
    for (const email of emails) {
      slackId = await lookupSlackUserByEmail(email);
      if (slackId) break;
    }
    if (!slackId) {
      return {
        ok: false,
        slackUserId: null,
        error:
          "No Slack account found for your emails on file. Make sure your DALI Slack uses one of them, then try again.",
      };
    }

    try {
      await prisma.user.update({ where: { id: userId }, data: { slackUserId: slackId } });
    } catch {
      // Unique collision: this Slack id is already linked to another account.
      return {
        ok: false,
        slackUserId: null,
        error: "That Slack account is already linked to another DALI OS user.",
      };
    }
    await logAuditEvent({
      action: "slack.connect",
      userId,
      targetId: userId,
      metadata: { slackUserId: slackId },
      request,
    });
    return { ok: true, slackUserId: slackId, error: null };
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

export default function SettingsSlackPage({ loaderData }: Route.ComponentProps) {
  const { slackUserId, configured, emails } = loaderData;
  const fetcher = useFetcher<typeof action>();
  // Prefer the just-submitted result, falling back to the loaded state.
  const connectedId =
    fetcher.data && "slackUserId" in fetcher.data ? fetcher.data.slackUserId : slackUserId;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const busy = fetcher.state !== "idle";

  return (
    <main className="max-w-3xl p-8">
      <header>
        <h1 className="text-2xl font-semibold">Slack</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Connect your Slack account so DALI OS can add you to your project's
          Slack channel automatically when you're staffed. We match your Slack
          account by the emails on your profile.
        </p>
      </header>

      <section className="mt-6">
        {!configured && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Slack isn't configured on the server, so connecting is unavailable
            right now.
          </div>
        )}

        {connectedId ? (
          <div className="overflow-hidden rounded-md border border-zinc-200 border-l-4 border-l-[#4A154B] bg-white">
            <div className="flex items-center justify-between bg-[#4A154B]/5 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Slack className="h-4 w-4 flex-shrink-0 text-[#4A154B]" />
                <span className="truncate text-sm font-semibold text-zinc-900">
                  Slack connected
                </span>
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
              </div>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="disconnect" />
                <button
                  type="submit"
                  disabled={busy}
                  aria-label="Disconnect Slack"
                  className="rounded-md p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </fetcher.Form>
            </div>
            <div className="px-3 py-3">
              <p className="text-xs text-zinc-600">
                Slack member ID:{" "}
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-800">
                  {connectedId}
                </code>
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-zinc-200 bg-white p-4">
            <p className="text-sm text-zinc-600">
              Your Slack account isn't connected yet.
            </p>
            {emails.length > 0 && (
              <p className="mt-1 text-xs text-zinc-500">
                We'll look you up by: {emails.join(", ")}.
              </p>
            )}
            <fetcher.Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="connect" />
              <button
                type="submit"
                disabled={busy || !configured}
                className="inline-flex items-center gap-2 rounded-md bg-[#4A154B] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#611f69] disabled:opacity-50"
              >
                <Slack className="h-4 w-4" />
                {busy ? "Connecting…" : "Connect Slack"}
              </button>
            </fetcher.Form>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </section>
    </main>
  );
}
