import { prisma } from "~/lib/db";
import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { resolveCandidateEmail } from "~/lib/candidate-email";

interface NotifyNewPostInput {
  offeringId: string;
  offeringTitle: string;
  postId: string; // top-level post for this notification
  authorUserId: string;
  authorName: string;
  bodyPreview: string;
  isFromInstructor: boolean;
  isReply: boolean;
  enrolledLink: string;
  /** Additional userIds to notify regardless of subscription (e.g. @-mentions). */
  forceRecipients?: string[];
}

/**
 * Apply the chosen notification policy:
 * - Top-level instructor post → email every Approved enrollee.
 * - Top-level student post → email all instructors + author.
 * - Reply → email all subscribers of the top-level post + all instructors.
 * In all cases, write an in-app Notification for every recipient.
 */
export async function notifyDiscussionPost(input: NotifyNewPostInput): Promise<{ recipients: number; emailsSent: number }> {
  const recipientUserIds = await resolveRecipients(input);
  for (const uid of input.forceRecipients ?? []) recipientUserIds.add(uid);
  if (recipientUserIds.size === 0) return { recipients: 0, emailsSent: 0 };

  // Strip the author from email/in-app dispatch — they don't notify themselves.
  recipientUserIds.delete(input.authorUserId);
  if (recipientUserIds.size === 0) return { recipients: 0, emailsSent: 0 };

  const recipients = await prisma.user.findMany({
    where: { id: { in: Array.from(recipientUserIds) } },
    select: { id: true, firstName: true, dartmouthEmail: true, netId: true },
  });

  // In-app fan-out.
  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      recipientUserId: r.id,
      kind: "Education" as const,
      title: input.isReply
        ? `New reply in ${input.offeringTitle}`
        : `New discussion: ${input.offeringTitle}`,
      body: `${input.authorName}: ${input.bodyPreview.slice(0, 280)}`,
      link: input.enrolledLink,
    })),
  });

  let emailsSent = 0;
  try {
    const refreshToken = await getApplicationsGmailRefreshToken();
    if (refreshToken) {
      for (const r of recipients) {
        const intended = r.dartmouthEmail ?? (r.netId ? `${r.netId}@dartmouth.edu` : null);
        const { to } = resolveCandidateEmail(intended);
        if (!to) continue;
        const subject = input.isReply
          ? `Re: ${input.offeringTitle} discussion`
          : `${input.offeringTitle}: ${input.authorName} started a discussion`;
        const html = `<p>Hi ${escape(r.firstName ?? "there")},</p><p><strong>${escape(input.authorName)}</strong> wrote:</p><blockquote style="border-left:3px solid #ccc;padding-left:8px;color:#555">${escape(input.bodyPreview).replace(/\n/g, "<br/>")}</blockquote><p><a href="${input.enrolledLink}">Reply on DALI OS</a></p><p style="font-size:11px;color:#888">You're getting this because you posted or replied in this thread, or because an instructor posted. Open the thread on DALI OS to mute it.</p>`;
        try {
          await sendEmail({ refreshToken, to, subject, html });
          emailsSent += 1;
        } catch (err) {
          console.error("[education-discussions] one recipient email failed:", err);
        }
      }
    }
  } catch (err) {
    console.error("[education-discussions] email send failed:", err);
  }

  return { recipients: recipients.length, emailsSent };
}

async function resolveRecipients(input: NotifyNewPostInput): Promise<Set<string>> {
  const out = new Set<string>();

  // Instructors of the offering are always notified.
  const instructors = await prisma.instructorAssignment.findMany({
    where: { offeringId: input.offeringId },
    select: { userId: true },
    distinct: ["userId"],
  });
  for (const i of instructors) out.add(i.userId);

  if (!input.isReply && input.isFromInstructor) {
    // Top-level instructor post: blast to every Approved enrollee.
    const enrolled = await prisma.educationApplication.findMany({
      where: { offeringId: input.offeringId, status: "Approved" },
      select: { applicantUserId: true },
    });
    for (const e of enrolled) out.add(e.applicantUserId);
    return out;
  }

  if (input.isReply) {
    // Reply: subscribers of the top-level post + instructors (already added).
    const subs = await prisma.educationDiscussionSubscription.findMany({
      where: { postId: input.postId },
      select: { userId: true },
    });
    for (const s of subs) out.add(s.userId);
    return out;
  }

  // Top-level student post: instructors only (already added) + author (added,
  // will be stripped above). Author is implicitly subscribed.
  return out;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
