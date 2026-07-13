import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import {
  resolveCandidateEmail,
  redirectBannerHtml,
} from "~/lib/candidate-email";
import { bodyToHtml } from "~/lib/email";
import { recipientEmail, educationLink } from "./notifications.server";

export async function listAnnouncements(offeringId: string) {
  return prisma.educationAnnouncement.findMany({
    where: { offeringId },
    orderBy: { sentAt: "desc" },
    select: {
      id: true,
      body: true,
      sentAt: true,
      author: { select: { firstName: true, lastName: true } },
    },
  });
}

/**
 * Instructor broadcast to every Approved enrollee: announcement row, in-app
 * Notification per recipient, best-effort email per recipient.
 */
export async function postAnnouncement(args: {
  offeringId: string;
  authorId: string;
  body: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const body = args.body.trim();
  if (!body) return { error: "Announcement text is required", status: 400 };

  const offering = await prisma.educationOffering.findUnique({
    where: { id: args.offeringId },
    select: { id: true, title: true },
  });
  if (!offering) return { error: "Offering not found", status: 404 };

  const enrollees = await prisma.educationApplication.findMany({
    where: { offeringId: args.offeringId, status: "Approved" },
    select: {
      applicant: {
        select: {
          id: true,
          firstName: true,
          daliEmail: true,
          dartmouthEmail: true,
          personalEmail: true,
          netId: true,
        },
      },
    },
  });

  await prisma.educationAnnouncement.create({
    data: { offeringId: args.offeringId, authorId: args.authorId, body },
  });

  const title = `Announcement — ${offering.title}`;
  const recipients = enrollees
    .map((e) => e.applicant)
    .filter((u) => u.id !== args.authorId);

  if (recipients.length > 0) {
    try {
      await prisma.notification.createMany({
        data: recipients.map((u) => ({
          recipientUserId: u.id,
          createdByUserId: args.authorId,
          kind: "Education" as const,
          title,
          body,
          link: `${educationLink(u, offering.id)}/hub`,
        })),
      });
    } catch (err) {
      console.error("education announcement notifications failed", {
        offeringId: args.offeringId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const refreshToken = await getApplicationsGmailRefreshToken();
      if (refreshToken) {
        const html = bodyToHtml(body);
        for (const u of recipients) {
          const { to, redirectedFrom } = resolveCandidateEmail(recipientEmail(u));
          if (!to) continue;
          try {
            await sendEmail({
              refreshToken,
              to,
              subject: title,
              html: redirectBannerHtml(redirectedFrom) + html,
            });
          } catch (err) {
            console.error("education announcement email failed", {
              to,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch (err) {
      console.error("education announcement email batch failed", {
        offeringId: args.offeringId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await logAuditEvent({
    action: "education.announcement.create",
    userId: args.authorId,
    targetId: args.offeringId,
    metadata: { recipients: recipients.length },
  });
  return { ok: true };
}
