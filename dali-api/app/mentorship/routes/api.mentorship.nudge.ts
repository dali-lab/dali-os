import type { Route } from "./+types/api.mentorship.nudge";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { slackConfigured } from "~/slack/lib/slack-client";
import {
  notify,
  slackDmAllowed,
  absoluteLink,
  type NotifyRecipient,
} from "~/lib/notify.server";
import { mentorshipPairWhere, mentorNoteWhere } from "../lib/visibility";
import { buildGrid, isUnfilled } from "../lib/mentor-grid.server";

// POST /api/mentorship/nudge — Core-only. Slack-DMs the mentors who haven't
// filled in their notes (a due week with no rating) for the given term/filters,
// and records an in-app notification for each. The Slack DM is force-sent
// regardless of the mentor's notification preference (that's the point of the
// button), but stays prod-gated so staging/dev never DM real people.
//
// Body: { termId, projectId?, domainId?, mentorId?, intro? }
//   mentorId present  → nudge just that one mentor (per-mentor button)
//   mentorId absent   → nudge everyone behind in the scoped view (bulk button)

type NudgeBody = {
  termId: string;
  projectId?: string;
  domainId?: string;
  mentorId?: string;
  intro?: string;
};

const DEFAULT_INTRO =
  "This is a reminder to fill in your weekly mentorship notes.";

function isNudgeBody(x: unknown): x is NudgeBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.termId === "string" && o.termId.length > 0;
}

type Outstanding = { menteeName: string; weeks: number[] };

function summaryLines(items: Outstanding[]): string {
  return items
    .map(
      (i) =>
        `• ${i.menteeName} — ${
          i.weeks.length === 1
            ? `week ${i.weeks[0]}`
            : `weeks ${i.weeks.join(", ")}`
        }`,
    )
    .join("\n");
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "POST") {
    return withCors(
      request,
      Response.json({ error: "Method not allowed" }, { status: 405 }),
    );
  }
  if (!(await isCore(auth.user.sub))) {
    return withCors(
      request,
      Response.json({ error: "Forbidden" }, { status: 403 }),
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(
      request,
      Response.json({ error: "Invalid JSON" }, { status: 400 }),
    );
  }
  if (!isNudgeBody(body)) {
    return withCors(
      request,
      Response.json({ error: "Invalid body" }, { status: 400 }),
    );
  }
  const intro = (body.intro?.trim() || DEFAULT_INTRO).slice(0, 1000);

  const term = await prisma.term.findUnique({
    where: { id: body.termId },
    select: { id: true, code: true, startDate: true, endDate: true },
  });
  if (!term) {
    return withCors(
      request,
      Response.json({ error: "Term not found" }, { status: 404 }),
    );
  }

  const [pairScope, noteScope] = await Promise.all([
    mentorshipPairWhere(auth.user.sub),
    mentorNoteWhere(auth.user.sub),
  ]);
  const grid = await buildGrid({
    term,
    filters: { projectId: body.projectId, domainId: body.domainId },
    viewerId: auth.user.sub,
    pairScope,
    noteScope,
  });

  // Collect each mentor's outstanding (unfilled) mentee-weeks. Optionally narrow
  // to a single mentor for the per-mentor button.
  const targets = grid.mentors
    .filter((m) => !body.mentorId || m.mentor.id === body.mentorId)
    .map((m) => {
      const outstanding: Outstanding[] = [];
      for (const row of m.rows) {
        const weeks = row.cells.filter(isUnfilled).map((c) => c.week);
        if (weeks.length > 0) {
          outstanding.push({
            menteeName: `${row.mentee.firstName} ${row.mentee.lastName}`.trim(),
            weeks,
          });
        }
      }
      return { mentorId: m.mentor.id, outstanding };
    })
    .filter((t) => t.outstanding.length > 0);

  if (targets.length === 0) {
    return withCors(
      request,
      Response.json({ messaged: [], skippedNoSlack: [], sentInEnv: true }),
    );
  }

  const users = await prisma.user.findMany({
    where: { id: { in: targets.map((t) => t.mentorId) } },
    select: { id: true, firstName: true, lastName: true, slackUserId: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const link = "/mentorship/browse";
  const absLink = absoluteLink(link);
  const weekStamp = new Date().toISOString().slice(0, 10);
  const canSlack = slackConfigured() && slackDmAllowed();

  const messaged: string[] = [];
  const skippedNoSlack: string[] = [];
  const enqueuedIds: Array<string | null> = [];

  for (const t of targets) {
    const user = userById.get(t.mentorId);
    if (!user) continue;
    const name = `${user.firstName} ${user.lastName}`.trim();
    const summary = summaryLines(t.outstanding);

    if (canSlack) {
      if (!user.slackUserId) {
        skippedNoSlack.push(name);
      } else {
        const slackText = [
          `Hi ${user.firstName},`,
          "",
          intro,
          "",
          `Still needed for ${term.code}:`,
          summary,
          ...(absLink ? ["", `<${absLink}|Open in DALI OS>`] : []),
        ].join("\n");
        const enq = await enqueueOutbound({
          channel: "slack_dm",
          dedupKey: `mentor-nudge:${t.mentorId}:${term.id}:${weekStamp}`,
          target: user.slackUserId,
          recipientUserId: t.mentorId,
          slackText,
          eventType: "mentorship.note_reminder",
          createdByUserId: auth.user.sub,
        });
        if (!enq.deduped) enqueuedIds.push(enq.id);
        messaged.push(name);
      }
    } else {
      // Non-prod: Slack is gated off, so nothing is DM'd. Still report who would
      // have been messaged so the UI can say "not sent in this environment".
      messaged.push(name);
    }
  }

  if (enqueuedIds.length > 0) await drainNow(enqueuedIds);

  // In-app trail for every targeted mentor (never write prisma.notification
  // directly). Per-recipient body carries their own outstanding list; the event
  // defaults slackDm:false so this doesn't double the forced Slack DM above.
  const recipients: NotifyRecipient[] = targets
    .filter((t) => userById.has(t.mentorId))
    .map((t) => ({
      userId: t.mentorId,
      body: `Still needed for ${term.code}:\n${summaryLines(t.outstanding)}`,
    }));
  await notify({
    eventType: "mentorship.note_reminder",
    createdByUserId: auth.user.sub,
    message: {
      title: "Fill in your mentorship notes",
      link,
    },
    recipients,
  });

  return withCors(
    request,
    Response.json({ messaged, skippedNoSlack, sentInEnv: canSlack }),
  );
}
