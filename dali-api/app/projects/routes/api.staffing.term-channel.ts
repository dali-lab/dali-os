import type { Route } from "./+types/api.staffing.term-channel";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { ensureChannel, inviteUsersToChannel } from "~/slack/lib/slack-client";
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
  return err instanceof Error ? err.message : String(err);
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
    // ProjectAssignment this term. Resolve to synced slackUserIds; nulls dropped
    // and counted per group so the lead sees who's missing a Slack account.
    const [coreRows, adminRows, assignmentRows] = await Promise.all([
      prisma.coreAssignment.findMany({
        where: { termId: term.id },
        select: { user: { select: { slackUserId: true } } },
      }),
      prisma.adminMembership.findMany({
        select: { user: { select: { slackUserId: true } } },
      }),
      prisma.projectAssignment.findMany({
        where: { termId: term.id },
        select: { user: { select: { slackUserId: true } } },
      }),
    ]);
    const coreIds = coreRows.map((r) => r.user.slackUserId).filter((id): id is string => !!id);
    const adminIds = adminRows.map((r) => r.user.slackUserId).filter((id): id is string => !!id);
    const memberIds = assignmentRows
      .map((r) => r.user.slackUserId)
      .filter((id): id is string => !!id);
    const slackIds = [...new Set([...coreIds, ...adminIds, ...memberIds])];

    const desiredName = body.channel?.trim() || term.code;
    const ch = await ensureChannel(desiredName);
    const inv = await inviteUsersToChannel(ch.id, slackIds);

    const missingTotal =
      coreRows.length + adminRows.length + assignmentRows.length - slackIds.length;
    const parts = [
      ch.created ? `created #${ch.name}` : `found #${ch.name}`,
      `invited ${inv.invited} (core ${coreIds.length}, admin ${adminIds.length}, project members ${memberIds.length})`,
    ];
    if (missingTotal > 0) parts.push(`some without a synced Slack id`);

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
