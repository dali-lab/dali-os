import { prisma } from "~/lib/db";
import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { resolveCandidateEmail } from "~/lib/candidate-email";
import { renderEmail } from "~/lib/email";
import type { EduApplicationStatus } from "~/generated/prisma/enums";

interface DecisionEmailInput {
  applicantUserId: string;
  offeringTitle: string;
  status: EduApplicationStatus;
  offeringId: string;
  enrolledLink: string | null;
  reason?: "decision" | "waitlist_promoted";
}

/**
 * Notify an applicant of an application status change. Writes an in-app
 * Notification row and best-effort sends a Gmail email via the shared
 * applications mailbox refresh token.
 */
export async function notifyApplicationStatus(input: DecisionEmailInput): Promise<{ emailSent: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: input.applicantUserId },
    select: { firstName: true, dartmouthEmail: true, netId: true },
  });
  if (!user) return { emailSent: false };

  const { title, body } = buildBody(input, user.firstName ?? "");

  await prisma.notification.create({
    data: {
      recipientUserId: input.applicantUserId,
      kind: "Education",
      title,
      body,
      link: input.enrolledLink,
    },
  });

  let emailSent = false;
  try {
    const intended = user.dartmouthEmail ?? (user.netId ? `${user.netId}@dartmouth.edu` : null);
    const { to } = resolveCandidateEmail(intended);
    if (to) {
      const refreshToken = await getApplicationsGmailRefreshToken();
      if (refreshToken) {
        // Check for a per-offering email template override; fall back to
        // the inline strings if none is bound. Variables: {{firstName}}
        // and {{domain}} (= offering title) are supported by the shared
        // renderEmail() interpolation.
        const binding = await prisma.offeringDecisionEmail.findUnique({
          where: { offeringId_status: { offeringId: input.offeringId, status: input.status } },
          include: { emailTemplateVersion: true },
        });
        let subject = title;
        let html = `<p>Hi ${escape(user.firstName ?? "there")},</p><p>${escape(body)}</p>${
          input.enrolledLink ? `<p><a href="${input.enrolledLink}">View on DALI OS</a></p>` : ""
        }<p>— DALI Lab</p>`;
        if (binding) {
          const rendered = renderEmail(
            { subject: binding.emailTemplateVersion.subject, body: binding.emailTemplateVersion.body },
            { firstName: user.firstName ?? "", domain: input.offeringTitle },
          );
          subject = rendered.subject;
          html = rendered.html +
            (input.enrolledLink ? `<p><a href="${input.enrolledLink}">View on DALI OS</a></p>` : "");
        }
        await sendEmail({ refreshToken, to, subject, html });
        emailSent = true;
      }
    }
  } catch (err) {
    console.error("[education] failed to send decision email:", err);
  }

  return { emailSent };
}

export async function notifyAnnouncement(input: {
  offeringId: string;
  offeringTitle: string;
  authorName: string;
  body: string;
  enrolledLink: string;
  /** Extra userIds to include (e.g. @-mentions outside the enrolled list). */
  extraRecipientUserIds?: string[];
}): Promise<{ recipients: number; emailsSent: number }> {
  const approved = await prisma.educationApplication.findMany({
    where: { offeringId: input.offeringId, status: "Approved" },
    include: {
      applicant: { select: { id: true, firstName: true, dartmouthEmail: true, netId: true } },
    },
  });
  // Fold in extra mentioned users that aren't already enrolled.
  const enrolledIds = new Set(approved.map((a) => a.applicant.id));
  const extras = (input.extraRecipientUserIds ?? []).filter((id) => !enrolledIds.has(id));
  if (extras.length > 0) {
    const extra = await prisma.user.findMany({
      where: { id: { in: extras } },
      select: { id: true, firstName: true, dartmouthEmail: true, netId: true },
    });
    for (const u of extra) approved.push({ applicant: u } as any);
  }

  // In-app notification fan-out.
  if (approved.length > 0) {
    await prisma.notification.createMany({
      data: approved.map((a) => ({
        recipientUserId: a.applicant.id,
        kind: "Education",
        title: `New announcement: ${input.offeringTitle}`,
        body: input.body.slice(0, 280),
        link: input.enrolledLink,
      })),
    });
  }

  let emailsSent = 0;
  try {
    const refreshToken = await getApplicationsGmailRefreshToken();
    if (refreshToken) {
      for (const app of approved) {
        const u = app.applicant;
        const intended = u.dartmouthEmail ?? (u.netId ? `${u.netId}@dartmouth.edu` : null);
        const { to } = resolveCandidateEmail(intended);
        if (!to) continue;
        const subject = `${input.offeringTitle}: ${input.authorName}`;
        const html = `<p>Hi ${escape(u.firstName ?? "there")},</p><p>${escape(input.body).replace(/\n/g, "<br/>")}</p><p><a href="${input.enrolledLink}">View on DALI OS</a></p><p>— ${escape(input.authorName)}</p>`;
        try {
          await sendEmail({ refreshToken, to, subject, html });
          emailsSent += 1;
        } catch (err) {
          console.error("[education] failed to send announcement to one recipient:", err);
        }
      }
    }
  } catch (err) {
    console.error("[education] announcement email send failed:", err);
  }

  return { recipients: approved.length, emailsSent };
}

function buildBody(input: DecisionEmailInput, firstName: string): { title: string; body: string } {
  const name = firstName || "there";
  switch (input.status) {
    case "Approved": {
      const title = input.reason === "waitlist_promoted"
        ? `A spot opened up: ${input.offeringTitle}`
        : `You're in: ${input.offeringTitle}`;
      const body = input.reason === "waitlist_promoted"
        ? `Hi ${name}, a seat opened up and you have been promoted off the waitlist for "${input.offeringTitle}". See you there!`
        : `Hi ${name}, your application to "${input.offeringTitle}" was accepted. We'll see you at the first session.`;
      return { title, body };
    }
    case "Waitlisted":
      return {
        title: `Waitlisted: ${input.offeringTitle}`,
        body: `Hi ${name}, "${input.offeringTitle}" filled up, so we've placed you on the waitlist. We'll let you know automatically if a spot opens.`,
      };
    case "Rejected":
      return {
        title: `Decision: ${input.offeringTitle}`,
        body: `Hi ${name}, thanks for applying to "${input.offeringTitle}". Unfortunately we weren't able to offer you a spot this time.`,
      };
    case "Withdrawn":
      return {
        title: `Withdrawn: ${input.offeringTitle}`,
        body: `Hi ${name}, your application to "${input.offeringTitle}" has been withdrawn.`,
      };
    case "Submitted":
      return {
        title: `Received: ${input.offeringTitle}`,
        body: `Hi ${name}, we got your application to "${input.offeringTitle}" — instructors will review it shortly.`,
      };
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
