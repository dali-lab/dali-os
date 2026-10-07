// GET /api/partner-contacts/:id/email-thread/:indexId
// Opens the full Gmail thread behind a partner contact's "Email with
// partners@" row — Core-only, no blind review. The actual message content is
// fetched live from Gmail with partners@'s own stored connection; the viewer
// never needs their own inbox hooked up to read it. Mirrors
// app/hiring/routes/api.applications.$id.email-thread.$indexId.ts.

import type { Route } from "./+types/api.partner-contacts.$id.email-thread.$indexId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { PARTNERS_FROM_EMAIL } from "~/lib/app-env";
import { canViewPartnerThread } from "~/partners/lib/partner-email.server";
import { getSharedInboxToken } from "~/email/lib/mail-index.server";
import { getThread, MailboxError } from "~/email/lib/gmail-mailbox.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;

  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("partner-email", userId, roles, request))) {
    return new Response("Not found", { status: 404 });
  }

  if (!(await canViewPartnerThread(userId, params.indexId, request))) {
    return new Response("Not found", { status: 404 });
  }

  const index = await prisma.mailMessageIndex.findUnique({
    where: { id: params.indexId },
    select: { threadId: true, linkedPartnerContactId: true },
  });
  if (!index || index.linkedPartnerContactId !== params.id) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const { token } = await getSharedInboxToken(PARTNERS_FROM_EMAIL, "Partners");
    const messages = await getThread(token, index.threadId);
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
      return Response.json({ error: "The partners@ inbox isn't connected right now." }, { status: 503 });
    }
    throw err;
  }
}
