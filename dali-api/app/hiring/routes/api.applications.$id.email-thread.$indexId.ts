// GET /api/hiring/applications/:id/email-thread/:indexId
// Opens the full Gmail thread behind an "Email with applications@" row,
// server-side — the viewer doesn't need their own inbox connection, only
// access to this applicant's review. Headers-only index rows gate the
// lookup; the actual message content is fetched live from Gmail with
// applications@'s own stored connection.

import type { Route } from "./+types/api.applications.$id.email-thread.$indexId";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canViewApplicantThread } from "~/hiring/lib/email-thread-access.server";
import { getSharedInboxToken } from "~/email/lib/mail-index.server";
import { getThread, MailboxError } from "~/email/lib/gmail-mailbox.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;

  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("applicant-email-engagement", userId, roles, request))) {
    return new Response("Not found", { status: 404 });
  }

  const access = await canViewApplicantThread({
    viewerId: userId,
    applicationId: params.id,
    indexId: params.indexId,
    request,
  });
  if (!access.ok) return new Response(access.status === 404 ? "Not found" : "Forbidden", { status: access.status });

  try {
    const { token } = await getSharedInboxToken(access.address);
    const messages = await getThread(token, access.threadId);
    return Response.json({
      messages: messages.map((m) => ({
        id: m.id,
        from: m.from,
        to: m.to,
        cc: m.cc,
        date: m.date,
        subject: m.subject,
        html: m.html,
        text: m.text,
        attachments: m.attachments.map((a) => ({ filename: a.filename, size: a.size })),
      })),
    });
  } catch (err) {
    if (err instanceof MailboxError) {
      return Response.json({ error: "The applications@ inbox isn't connected right now." }, { status: 503 });
    }
    throw err;
  }
}
