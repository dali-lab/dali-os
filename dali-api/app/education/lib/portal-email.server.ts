// The emails education sends directly, rather than through notify().
//
// They go to portal students — people with no DALI account, so no
// NotificationPreference rows and nothing to suppress them with. Four of them
// were the same three lines of markup repeated (greeting, a sentence, a bare
// link), each hand-escaped; this is that shape once, framed by the shared layout
// and carrying a plain-text part.
//
// The non-prod banner is deliberately NOT added here. resolveCandidateEmail used
// to both redirect the target and ask the caller to prepend a banner, while the
// transport redirected again and prepended a second one — so staging mail had two
// banners and the transport's named the test inbox rather than the real
// recipient. The transport owns both now, which also matters because a banner
// prepended to a laid-out email would land before the doctype.

import { escapeHtml } from "~/lib/email";
import { getFrontendUrl } from "~/lib/app-env";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { renderFramedEmail } from "~/email/lib/layout.server";

export async function sendEducationEmail(args: {
  to: string;
  recipientUserId: string;
  dedupKey: string;
  eventType: string;
  subject: string;
  firstName: string;
  // One or more paragraphs of plain text, escaped here.
  paragraphs: string[];
  cta?: { path: string; label: string };
}): Promise<void> {
  const href = args.cta ? `${getFrontendUrl()}${args.cta.path}` : null;
  const mail = await renderFramedEmail(
    {
      subject: args.subject,
      preheader: args.paragraphs[0]?.slice(0, 140) ?? args.subject,
      cta: href && args.cta ? { href, label: args.cta.label } : undefined,
      bodyHtml: [
        `<p style="margin:0 0 16px;">Hi ${escapeHtml(args.firstName)},</p>`,
        ...args.paragraphs.map(
          (p, i) =>
            `<p style="margin:0${i === args.paragraphs.length - 1 ? "" : " 0 16px"};">${escapeHtml(p)}</p>`,
        ),
      ].join("\n"),
      text: [
        `Hi ${args.firstName},`,
        ...args.paragraphs,
        ...(href && args.cta ? [`${args.cta.label}: ${href}`] : []),
      ].join("\n\n"),
    },
    { footer: "transactional" },
  );

  const { id } = await enqueueOutbound({
    channel: "email",
    purpose: "Education",
    dedupKey: args.dedupKey,
    target: args.to,
    recipientUserId: args.recipientUserId,
    subject: mail.subject,
    bodyHtml: mail.html,
    bodyText: mail.text,
    eventType: args.eventType,
  });
  await drainNow([id]);
}
