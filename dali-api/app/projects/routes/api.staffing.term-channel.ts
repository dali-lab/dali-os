import type { Route } from "./+types/api.staffing.term-channel";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { ensureChannel, inviteUsersToChannel } from "~/slack/lib/slack-client";
import { resolveSlackIdsForInvite } from "~/members/lib/slack-sync.server";
import { logAuditEvent } from "~/lib/audit";

// POST /api/staffing/term-channel
//
// Get-or-create a term-wide Slack channel (e.g. #26x) and invite everyone active
// for that term: all current-term Core, all Admin/staff, and everyone with a
// ProjectAssignment in the term. Idempotent — safe to re-run.
//
// Body: { termId: string; channel?: string }  — channel defaults to the term code.

type Body = { termId: string; channel?: string };

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.termId === "string" &&
    (o.channel === undefined || typeof o.channel === "string")
  );
}

function errMsg(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/missing_scope/i.test(raw)) {
    return `${raw} — the Slack bot token is missing a scope. Needs channels:manage + channels:read (create/invite), chat:write, and users:read.email. Add them in the Slack app config and reinstall.`;
  }
  if (/not_in_channel|channel_not_found/i.test(raw)) {
    return `${raw} — the Slack bot isn't a member of that channel.`;
  }
  return raw;
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await canManageStaffing(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  if (!process.env.SLACK_BOT_TOKEN) {
    return withCors(request, Response.json({ error: "SLACK_BOT_TOKEN not set." }, { status: 400 }));
  }

  const term = await prisma.term.findUnique({
    where: { id: body.termId },
    select: { id: true, code: true },
  });
  if (!term) {
    return withCors(request, Response.json({ error: "Term not found" }, { status: 404 }));
  }

  try {
    // Invite set: current-term Core + all Admin/staff + everyone with a
    // ProjectAssignment this term. resolveSlackIdsForInvite uses each user's
    // stored slackUserId, OR looks it up by email and persists it for next time —
    // so members who never linked Slack still get invited.
    const userSelect = {
      id: true,
      slackUserId: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
    } as const;
    const [coreRows, adminRows, assignmentRows] = await Promise.all([
      prisma.coreAssignment.findMany({
        where: { termId: term.id },
        select: { user: { select: userSelect } },
      }),
      prisma.adminMembership.findMany({
        select: { user: { select: userSelect } },
      }),
      prisma.projectAssignment.findMany({
        where: { termId: term.id },
        select: { user: { select: userSelect } },
      }),
    ]);
    const candidates = [
      ...coreRows.map((r) => r.user),
      ...adminRows.map((r) => r.user),
      ...assignmentRows.map((r) => r.user),
    ];
    const { slackIds, unresolvedUserIds } = await resolveSlackIdsForInvite(candidates);

    const desiredName = body.channel?.trim() || term.code;
    const ch = await ensureChannel(desiredName);
    const inv = await inviteUsersToChannel(ch.id, slackIds);

    const parts = [
      ch.created ? `created #${ch.name}` : `found #${ch.name}`,
      `invited ${inv.invited} (core + admin + project members)`,
    ];
    if (unresolvedUserIds.length > 0) {
      parts.push(`${unresolvedUserIds.length} without a Slack account (no email match)`);
    }

    await logAuditEvent({
      action: "staffing.term_channel",
      userId: auth.user.sub,
      metadata: { termId: term.id, channel: ch.name, invited: inv.invited },
    });

    return withCors(
      request,
      Response.json({ ok: true, channel: ch.name, message: `${parts.join("; ")}.` }),
    );
  } catch (err) {
    return withCors(request, Response.json({ error: errMsg(err) }, { status: 500 }));
  }
}
