import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { bodyToHtml, interpolate } from "~/lib/email";
import type { EduApplicationStatus } from "~/generated/prisma/enums";

// Education transactional emails. Templates live inline (no DB-stored
// templates in MVP). All three sends are best-effort: failure does not
// roll back the calling transaction.

interface BaseRecipient {
  email: string;
  firstName: string;
}

function decisionSubject(status: EduApplicationStatus, offeringTitle: string): string {
  if (status === "Approved") return `You're in: ${offeringTitle}`;
  if (status === "Rejected") return `Update on your ${offeringTitle} application`;
  if (status === "Waitlisted") return `Waitlisted: ${offeringTitle}`;
  return `Update on your ${offeringTitle} application`;
}

function decisionBody(
  status: EduApplicationStatus,
  offeringTitle: string,
  reviewerNote: string | null,
): string {
  const intro: Record<string, string> = {
    Approved: `Welcome to ${offeringTitle}! Your application has been approved. You'll find session details and any pre-reads on your "My Learning" page in DALI OS.`,
    Rejected: `Thanks for applying to ${offeringTitle}. We weren't able to offer you a spot this round, but please apply again in the future.`,
    Waitlisted: `Thanks for applying to ${offeringTitle}. You're on the waitlist — if a spot opens up, we'll let you know in DALI OS.`,
  };
  const body = intro[status] ?? `Your ${offeringTitle} application status changed to ${status}.`;
  if (reviewerNote && reviewerNote.trim().length > 0) {
    return `${body}\n\nNote from the instructor:\n${reviewerNote.trim()}`;
  }
  return body;
}

export async function sendApplicationSubmittedEmail(opts: {
  to: BaseRecipient;
  offeringTitle: string;
  requiresReview: boolean;
}): Promise<void> {
  const refreshToken = await getApplicationsGmailRefreshToken();
  if (!refreshToken) return;
  const subject = `Application received: ${opts.offeringTitle}`;
  const bodyText = opts.requiresReview
    ? `Hi {{firstName}},\n\nWe've received your application for ${opts.offeringTitle}. You'll hear back once the instructor has reviewed it.`
    : `Hi {{firstName}},\n\nYou're registered for ${opts.offeringTitle}. See you in class!`;
  const html = bodyToHtml(
    interpolate(bodyText, { firstName: opts.to.firstName }),
  );
  try {
    await sendEmail({ refreshToken, to: opts.to.email, subject, html });
  } catch (err) {
    console.error("[education:email] application-submitted failed", err);
  }
}

export async function sendDecisionEmail(opts: {
  to: BaseRecipient;
  offeringTitle: string;
  status: EduApplicationStatus;
  reviewerNote: string | null;
}): Promise<void> {
  const refreshToken = await getApplicationsGmailRefreshToken();
  if (!refreshToken) return;
  const subject = decisionSubject(opts.status, opts.offeringTitle);
  const bodyText = `Hi {{firstName}},\n\n${decisionBody(opts.status, opts.offeringTitle, opts.reviewerNote)}`;
  const html = bodyToHtml(
    interpolate(bodyText, { firstName: opts.to.firstName }),
  );
  try {
    await sendEmail({ refreshToken, to: opts.to.email, subject, html });
  } catch (err) {
    console.error("[education:email] decision failed", err);
  }
}

export async function sendAnnouncementEmail(opts: {
  to: BaseRecipient;
  offeringTitle: string;
  authorName: string;
  body: string;
}): Promise<void> {
  const refreshToken = await getApplicationsGmailRefreshToken();
  if (!refreshToken) return;
  const subject = `[${opts.offeringTitle}] Announcement from ${opts.authorName}`;
  const bodyText = `Hi {{firstName}},\n\n${opts.body}\n\n— ${opts.authorName}`;
  const html = bodyToHtml(
    interpolate(bodyText, { firstName: opts.to.firstName }),
  );
  try {
    await sendEmail({ refreshToken, to: opts.to.email, subject, html });
  } catch (err) {
    console.error("[education:email] announcement failed", err);
  }
}
